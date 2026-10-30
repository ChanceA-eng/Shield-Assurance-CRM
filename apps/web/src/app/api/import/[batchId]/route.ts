import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { buildProspects, detectVendorProfile, type ImportRow, type VendorProfile } from '../../../../lib/lead-import';

interface RouteContext {
  params: Promise<{ batchId: string }>;
}

interface StagedRow {
  id: string;
  disposition: string;
  payload: { profile?: Record<string, unknown>; raw?: ImportRow[] } | null;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { batchId } = await context.params;

  const [batchRes, prospectsRes] = await Promise.all([
    supabase.from('import_batches').select('*').eq('id', batchId).maybeSingle(),
    supabase
      .from('import_prospects')
      .select('*')
      .eq('batch_id', batchId)
      .order('full_name', { ascending: true })
      .limit(2000),
  ]);

  if (batchRes.error) return NextResponse.json({ message: batchRes.error.message }, { status: 500 });
  if (!batchRes.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });
  if (prospectsRes.error) return NextResponse.json({ message: prospectsRes.error.message }, { status: 500 });

  return NextResponse.json({ batch: batchRes.data, prospects: prospectsRes.data ?? [] }, { status: 200 });
}

/** Batch actions: restore skipped/duplicate prospects back to review. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { batchId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    ids?: string[];
    id?: string;
    full_name?: string;
    email?: string;
    phone?: string;
    address?: string;
  };

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

    const { error } = await supabase
      .from('import_prospects')
      .update(updates)
      .eq('id', prospectId)
      .eq('batch_id', batchId);
    if (error) return NextResponse.json({ message: error.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (body.action === 'reparse') {
    // Re-run the current parser over each staged prospect's raw rows —
    // upgrades batches staged before parser improvements.
    const batchRes = await supabase.from('import_batches').select('vendor_profile').eq('id', batchId).maybeSingle<{ vendor_profile: string }>();
    if (batchRes.error || !batchRes.data) {
      return NextResponse.json({ message: batchRes.error?.message ?? 'Batch not found.' }, { status: 404 });
    }

    const staged = await supabase
      .from('import_prospects')
      .select('id,disposition,payload')
      .eq('batch_id', batchId)
      .limit(2000);
    if (staged.error) return NextResponse.json({ message: staged.error.message }, { status: 500 });

    let reparsed = 0;
    for (const row of (staged.data ?? []) as StagedRow[]) {
      const raw = row.payload?.raw;
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const vendorProfile = (batchRes.data.vendor_profile || detectVendorProfile(raw)) as VendorProfile;
      const rebuilt = buildProspects(raw, vendorProfile)[0];
      if (!rebuilt) continue;

      const update = await supabase
        .from('import_prospects')
        .update({
          full_name: rebuilt.full_name,
          email: rebuilt.email,
          phone: rebuilt.phone,
          address: rebuilt.address,
          line_of_business: rebuilt.line_of_business,
          payload: { profile: rebuilt.profile, raw },
        })
        .eq('id', row.id);
      if (!update.error) reparsed += 1;
    }

    return NextResponse.json({ ok: true, reparsed }, { status: 200 });
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
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  await supabase.from('import_batches').update({ status: 'review' }).eq('id', batchId);

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { batchId } = await context.params;
  const { error } = await supabase.from('import_batches').delete().eq('id', batchId);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
