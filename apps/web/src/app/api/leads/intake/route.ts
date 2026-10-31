import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../../lib/api-auth';
import { scheduleIntakeTask } from '../../../../lib/intake-task';
import { processLeadStatusChanged } from '../../../../lib/automation';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { validateAsset } from '../../../../lib/workspace-validation';
import { findExistingMatches, phoneDigits, prepareLead, validateAgentIntake, type ExistingRecord } from '../../../../lib/agent-lead-intake';

type Candidate = Omit<ExistingRecord, 'match'>;

async function existingRecords(db: SupabaseClient, email: string, phone: string): Promise<ExistingRecord[]> {
  if (!email && phoneDigits(phone).length !== 10) return [];
  const rows: Candidate[] = [];
  for (const table of ['leads', 'clients'] as const) {
    const columns = table === 'leads' ? 'id,full_name,business,email,phone,address,state,zip,status,line_of_business' : 'id,full_name,email,phone,address';
    for (let offset = 0; ; offset += 500) {
      const result = await db.from(table).select(columns).order('id').range(offset, offset + 499);
      if (result.error) throw databaseError(result.error);
      const batch = (result.data ?? []) as unknown as Array<Record<string, string | null>>;
      for (const row of batch) {
        rows.push({
          type: table === 'leads' ? 'lead' : 'account',
          id: String(row.id),
          full_name: row.full_name ?? 'Unnamed record',
          business: row.business ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          address: row.address ?? null,
          state: row.state ?? null,
          zip: row.zip ?? null,
          status: row.status ?? null,
          line_of_business: row.line_of_business ?? null,
        });
      }
      if (batch.length < 500) break;
    }
  }
  return findExistingMatches(rows, email, phone);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const email = request.nextUrl.searchParams.get('email')?.trim() ?? '';
    const phone = request.nextUrl.searchParams.get('phone')?.trim() ?? '';
    if (email.length > 254 || phone.length > 40) throw new WorkspaceError('Search with a valid email or phone.', 400);
    return NextResponse.json({ matches: await existingRecords(db, email, phone) });
  } catch (error) {
    return workspaceApiError(error, 'leads/intake/lookup');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  let leadId: string | null = null;
  try {
    const body = await workspaceBody(request);
    const intake = validateAgentIntake(body.intake);
    if (typeof intake === 'string') throw new WorkspaceError(intake, 400);
    if (body.allow_duplicate !== undefined && typeof body.allow_duplicate !== 'boolean') throw new WorkspaceError('allow_duplicate must be true or false.', 400);

    const actor = apiActorName(session.user);
    const prepared = prepareLead(intake, actor);
    const assets = prepared.assets.map((asset) => {
      const validated = validateAsset({ ...asset, source: 'client_reported' });
      if (typeof validated === 'string') throw new WorkspaceError(`${asset.title}: ${validated}`, 400);
      return validated;
    });

    if (body.allow_duplicate !== true) {
      const matches = await existingRecords(db, intake.contact.email, intake.contact.phone);
      if (matches.length) {
        return NextResponse.json({ message: 'This person may already be in the CRM.', matches }, { status: 409 });
      }
    }

    const inserted = await db.from('leads').insert([prepared.lead]).select('id,full_name,status').single<{ id: string; full_name: string; status: string }>();
    if (inserted.error) throw databaseError(inserted.error);
    leadId = inserted.data.id;

    if (assets.length) {
      const reportedAt = new Date().toISOString();
      const { error } = await db.from('client_assets').insert(assets.map((asset) => ({
        lead_id: leadId, client_id: null, title: asset.title, asset_type: asset.asset_type, created_by: actor,
        metadata: { version: 1, details: asset.details, source: asset.source, source_reference: null, reported_at: reportedAt },
      })));
      if (error) throw databaseError(error);
    }

    if (prepared.note) {
      const { error } = await db.rpc('save_note_with_reminder', {
        p_id: crypto.randomUUID(), p_lead_id: leadId, p_client_id: null, p_content: prepared.note, p_note_type: 'call',
        p_author_id: session.user.id, p_author_name: actor, p_reminder: null,
      });
      if (error) throw databaseError(error);
    }

    await scheduleIntakeTask(db, { leadId, name: inserted.data.full_name, warm: prepared.warm });
    await processLeadStatusChanged({ leadId, leadName: inserted.data.full_name, status: inserted.data.status });
    return NextResponse.json({ id: leadId }, { status: 201 });
  } catch (error) {
    if (leadId) {
      // Roll back the partially created lead so the pipeline never shows half an intake.
      await db.from('client_assets').delete().eq('lead_id', leadId);
      await db.from('interactions').delete().eq('lead_id', leadId);
      await db.from('leads').delete().eq('id', leadId);
    }
    return workspaceApiError(error, 'leads/intake');
  }
}
