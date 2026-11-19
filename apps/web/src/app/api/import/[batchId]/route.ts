import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getApiSession } from '../../../../lib/api-auth';
import { discoveryAccess } from '../../../../lib/discovery';
import { buildProspects, detectVendorProfile, type ImportRow, type VendorProfile } from '../../../../lib/lead-import';

import { friendlyErrorMessage, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ batchId: string }>;
}

interface StagedRow {
  id: string;
  disposition: string;
  payload: { profile?: Record<string, unknown>; raw?: ImportRow[] } | null;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { batchId } = await context.params;

  const batchRes = await supabase.from('import_batches').select('*').eq('id', batchId).maybeSingle();

  if (batchRes.error) return NextResponse.json({ message: friendlyErrorMessage(batchRes.error) }, { status: 500 });
  if (!batchRes.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });
  if (batchRes.data.discovery_source_id) {
    try { await discoveryAccess(supabase, session.user.id); } catch (error) { return workspaceApiError(error, 'discovery/import-read'); }
  }
  const prospects: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from('import_prospects').select('*').eq('batch_id', batchId)
      .order('full_name', { ascending: true }).order('id').range(offset, offset + 499);
    if (result.error) return NextResponse.json({ message: friendlyErrorMessage(result.error) }, { status: 500 });
    prospects.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) break;
  }

  return NextResponse.json({ batch: batchRes.data, prospects }, { status: 200 });
}

/** Batch actions: restore skipped/duplicate prospects back to review. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { batchId } = await context.params;
  const batchAccess = await supabase.from('import_batches').select('discovery_source_id').eq('id', batchId).maybeSingle();
  if (batchAccess.error) return NextResponse.json({ message: friendlyErrorMessage(batchAccess.error) }, { status: 500 });
  if (!batchAccess.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });
  if (batchAccess.data.discovery_source_id) {
    try { await discoveryAccess(supabase, session.user.id); } catch (error) { return workspaceApiError(error, 'discovery/import-review'); }
  }
  let body: Record<string, unknown>;
  try { body = await workspaceBody(request); } catch (failure) { return workspaceApiError(failure, 'import/review'); }

  if (body.action === 'update') {
    // Manual fix-up of a staged prospect (contact info, name) before commit.
    const prospectId = typeof body.id === 'string' ? body.id : '';
    if (!prospectId) return NextResponse.json({ message: 'Prospect id is required.' }, { status: 400 });

    const updates: Record<string, string | null> = {};
    if (typeof body.full_name === 'string' && body.full_name.trim()) updates.full_name = body.full_name.trim();
    if (typeof body.email === 'string') updates.email = body.email.trim().toLowerCase() || null;
    if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null;
    if (typeof body.address === 'string') updates.address = body.address.trim() || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'No update fields provided.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('import_prospects')
      .update(updates)
      .eq('id', prospectId)
      .eq('batch_id', batchId)
      .neq('disposition', 'committed')
      .select('id');
    if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
    if (!data?.length) return NextResponse.json({ message: 'This prospect is no longer available for review. Refresh the batch.' }, { status: 409 });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (body.action === 'reparse') {
    // Re-run the current parser over each staged prospect's raw rows —
    // upgrades batches staged before parser improvements.
    const batchRes = await supabase.from('import_batches').select('vendor_profile').eq('id', batchId).maybeSingle<{ vendor_profile: string }>();
    if (batchRes.error) return NextResponse.json({ message: friendlyErrorMessage(batchRes.error) }, { status: 500 });
    if (!batchRes.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });
    const staged: StagedRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from('import_prospects').select('id,disposition,payload')
        .eq('batch_id', batchId).neq('disposition', 'committed').order('id').range(offset, offset + 499);
      if (result.error) return NextResponse.json({ message: friendlyErrorMessage(result.error) }, { status: 500 });
      staged.push(...(result.data ?? []));
      if ((result.data ?? []).length < 500) break;
    }

    let reparsed = 0;
    const errors: string[] = [];
    for (const row of staged) {
      const raw = row.payload?.raw;
      if (!Array.isArray(raw) || raw.length === 0) { errors.push(`${row.id}: Source rows are missing; review this prospect.`); continue; }
      const configured = batchRes.data.vendor_profile;
      const vendorProfile: VendorProfile = configured === 'commercial' || configured === 'personal_auto' || configured === 'generic'
        ? configured : detectVendorProfile(raw);
      const rebuilt = buildProspects(raw, vendorProfile);
      if (rebuilt.length !== 1) { errors.push(`${row.id}: Source rows resolve to multiple prospects. Upload the source again to review separate branches.`); continue; }

      const update = await supabase
        .from('import_prospects')
        .update({
          payload: { ...row.payload, profile: rebuilt[0].profile, raw },
        })
        .eq('id', row.id).eq('batch_id', batchId).neq('disposition', 'committed')
        .eq('payload', JSON.stringify(row.payload)).select('id');
      if (update.error) errors.push(`${row.id}: ${friendlyErrorMessage(update.error)}`);
      else if (!update.data?.length) errors.push(`${row.id}: Prospect changed during reparse. Refresh before retrying.`);
      else reparsed += 1;
    }

    return NextResponse.json({ ok: errors.length === 0, reparsed, errors,
      ...(errors.length ? { message: `${errors.length} prospects need review. ${errors[0]}` } : {}) }, { status: errors.length ? 409 : 200 });
  }

  if (body.action !== 'restore') {
    return NextResponse.json({ message: 'Unsupported action.' }, { status: 400 });
  }

  let query = supabase
    .from('import_prospects')
    .update({ disposition: 'pending', duplicate_of: null })
    .eq('batch_id', batchId)
    .in('disposition', ['skipped', 'duplicate']);

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    query = query.in('id', body.ids);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });

  const batchUpdate = await supabase.from('import_batches').update({ status: 'review' }).eq('id', batchId);
  if (batchUpdate.error) return NextResponse.json({ message: 'Prospects restored, but the batch status could not be saved. Refresh before continuing.' }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { batchId } = await context.params;
  const batchAccess = await supabase.from('import_batches').select('discovery_source_id').eq('id', batchId).maybeSingle();
  if (batchAccess.error) return NextResponse.json({ message: friendlyErrorMessage(batchAccess.error) }, { status: 500 });
  if (!batchAccess.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });
  if (batchAccess.data.discovery_source_id) {
    try { await discoveryAccess(supabase, session.user.id); } catch (error) { return workspaceApiError(error, 'discovery/import-delete'); }
  }
  const { error } = await supabase.from('import_batches').delete().eq('id', batchId);
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
