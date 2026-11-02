import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { runRenewalRadar } from '../../../../lib/renewal-automation';
import { applyResubmission } from '../../../../lib/resubmission';
import { scheduleIntakeTask } from '../../../../lib/intake-task';
import { sourceSubmissionId } from '../../../../lib/website-intake';
import type { SupabaseClient } from '@supabase/supabase-js';
import { trackedAutomation, type AutomationRun } from '../../../../lib/automation-health';

export const runtime = 'nodejs';

interface SyncLeadRecord {
  full_name: string;
  email: string | null;
  phone: string | null;
  details: string | null;
  source: string;
  status: string;
  form_payload: Record<string, unknown>;
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (cronSecret && bearer === cronSecret) return true;

  return false;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function normalizeStatus(value: unknown): string {
  const normalized = asString(value)?.toLowerCase();
  return normalized || 'new';
}

function extractLeadArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  if (typeof payload === 'object' && payload !== null) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
  }

  return [];
}

function buildDetails(lead: Record<string, unknown>): string | null {
  const excluded = new Set(['full_name', 'name', 'email', 'phone', 'status']);
  const lines = Object.entries(lead)
    .filter(([key]) => !excluded.has(key.toLowerCase()))
    .map(([key, value]) => {
      const normalized = asString(value);
      if (normalized) {
        return `${key.toUpperCase()}: ${normalized}`;
      }

      try {
        return `${key.toUpperCase()}: ${JSON.stringify(value)}`;
      } catch {
        return `${key.toUpperCase()}: [unserializable]`;
      }
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

/** Digs the submitter's identity out of the website payload, wherever it lives. */
function extractIdentity(lead: Record<string, unknown>): { fullName: string; email: string | null; phone: string | null } {
  const metadata = (lead.metadata ?? {}) as Record<string, unknown>;
  const routing = (metadata.routing ?? {}) as Record<string, unknown>;

  const fullName =
    asString(lead.full_name) ??
    asString(lead.name) ??
    asString(lead.client_name) ??
    asString(routing.fullName) ??
    'Unknown Web Lead';

  const emailRaw = asString(lead.email) ?? asString(routing.email);
  const phone = asString(lead.phone) ?? asString(routing.phone);

  return { fullName, email: emailRaw ? emailRaw.toLowerCase() : null, phone };
}

function normalizeExternalLead(lead: Record<string, unknown>): SyncLeadRecord {
  const identity = extractIdentity(lead);

  return {
    full_name: identity.fullName,
    email: identity.email,
    phone: identity.phone,
    details: buildDetails(lead),
    source: 'website-pull',
    status: normalizeStatus(lead.status),
    form_payload: lead,
  };
}

/**
 * The export returns ALL submissions every time, so each one is identified by
 * its website id (falling back to its submission timestamp). A submission is
 * processed only once, even after it is archived by a later resubmission.
 */
function externalIdOf(payload: Record<string, unknown>): string | null {
  return sourceSubmissionId(payload);
}

async function syncWebsite(supabase: SupabaseClient): Promise<NextResponse> {
  const exportUrl = process.env.WEBSITE_LEADS_EXPORT_URL?.trim() || 'https://www.shield-assurance.com/api/export-submissions';
  const syncToken = process.env.WEBSITE_SYNC_TOKEN?.trim();

  if (!syncToken) {
    return NextResponse.json(
      {
        ok: true,
        pulled: 0,
        inserted: 0,
        resubmissions: 0,
        skippedExisting: 0,
        syncSkipped: 'WEBSITE_SYNC_TOKEN is not configured.',
      },
      { status: 200 },
    );
  }

  const webResponse = await fetch(exportUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!webResponse.ok) {
    return NextResponse.json(
      { message: `Failed to pull website submissions. HTTP ${webResponse.status} ${webResponse.statusText}` },
      { status: 502 },
    );
  }

  const responsePayload: unknown = await webResponse.json();
  const externalLeads = extractLeadArray(responsePayload);

  if (externalLeads.length === 0) {
    return NextResponse.json(
      { ok: true, pulled: 0, inserted: 0, resubmissions: 0, skippedExisting: 0 },
      { status: 200 },
    );
  }

  // A durable ledger recognizes direct pushes and pulls, even after many resubmissions.
  const ingestedIds = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const ledger = await supabase.from('lead_intake_events').select('source_submission_id').order('id').range(offset, offset + 999);
    if (ledger.error) return NextResponse.json({ message: ledger.error.message }, { status: 500 });
    for (const row of ledger.data ?? []) {
      if (row.source_submission_id) ingestedIds.add(row.source_submission_id);
    }
    if ((ledger.data ?? []).length < 1000) break;
  }

  // Oldest first, so when someone submitted multiple times the latest ends up current.
  const normalizedLeads = externalLeads
    .map(normalizeExternalLead)
    .sort((a, b) => (externalIdOf(a.form_payload) ?? '').localeCompare(externalIdOf(b.form_payload) ?? '', undefined, { numeric: true }));

  const fresh = normalizedLeads.filter((lead) => {
    const externalId = externalIdOf(lead.form_payload);
    return !externalId || !ingestedIds.has(externalId);
  });
  const skippedExisting = normalizedLeads.length - fresh.length;

  // Match fresh submissions to existing leads by email (resubmission detection).
  const candidateEmails = Array.from(new Set(fresh.map((lead) => lead.email).filter((email): email is string => Boolean(email))));
  const matchByEmail = new Map<string, string>();
  if (candidateEmails.length > 0) {
    const { data: matches, error: matchError } = await supabase
      .from('leads')
      .select('id,email,created_at')
      .in('email', candidateEmails)
      .order('created_at', { ascending: false });
    if (matchError) {
      return NextResponse.json({ message: matchError.message }, { status: 500 });
    }
    for (const match of matches ?? []) {
      const email = asString(match.email)?.toLowerCase();
      if (email && !matchByEmail.has(email)) matchByEmail.set(email, match.id as string);
    }
  }

  let inserted = 0;
  let resubmissions = 0;
  const errors: string[] = [];

  for (const lead of fresh) {
    const existingId = lead.email ? matchByEmail.get(lead.email) : undefined;

    if (existingId) {
      const { data: existing, error: existingError } = await supabase
        .from('leads')
        .select('id,full_name,status,form_payload')
        .eq('id', existingId)
        .maybeSingle<{ id: string; full_name: string; status: string | null; form_payload: Record<string, unknown> | null }>();
      if (existingError) {
        errors.push(existingError.message);
        continue;
      }
      if (existing) {
        try {
          const applied = await applyResubmission(supabase, existing, lead.form_payload, {
            fullName: lead.full_name !== 'Unknown Web Lead' ? lead.full_name : null, email: lead.email, phone: lead.phone,
          });
          if (applied) resubmissions += 1;
          continue;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'Website resubmission failed.');
          continue;
        }
      }
    }

    const insertResult = await supabase.from('leads').insert([lead]).select('id,full_name').single<{ id: string; full_name: string }>();
    if (insertResult.error) {
      errors.push(insertResult.error.message);
      continue;
    }
    inserted += 1;
    if (lead.email) matchByEmail.set(lead.email, insertResult.data.id);
    await scheduleIntakeTask(supabase, { leadId: insertResult.data.id, name: insertResult.data.full_name, warm: true });
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      pulled: normalizedLeads.length,
      inserted,
      resubmissions,
      skippedExisting,
      ...(errors.length > 0 ? { errors: errors.slice(0, 5) } : {}),
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  if (!isAuthorizedCron(request)) {
    const error = await requireApiSession(request);
    if (error) return error;
  }
  const runs: AutomationRun[] = [];
  try {
    runs.push(await trackedAutomation(supabase, 'follow-up-routine', async () => {
      const result = await supabase.rpc('ensure_default_followups');
      if (result.error) throw new Error(result.error.message);
      return { status: 'succeeded', summary: { created: result.data } };
    }));
    runs.push(await trackedAutomation(supabase, 'outreach', async () => ({ status: 'succeeded', summary: await processDueEnrollments(supabase) })));
    runs.push(await trackedAutomation(supabase, 'renewal-radar', async () => ({ status: 'succeeded', summary: await runRenewalRadar(supabase) })));
    runs.push(await trackedAutomation(supabase, 'website-intake', async () => {
      const response = await syncWebsite(supabase);
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Website pull failed.');
      return {
        status: result.syncSkipped ? 'skipped' : result.ok === false ? 'partial' : 'succeeded',
        summary: result,
        error: typeof result.syncSkipped === 'string' ? result.syncSkipped : Array.isArray(result.errors) ? result.errors.join('; ') : undefined,
      };
    }));
    runs.push(await trackedAutomation(supabase, 'internal-actions', async () => {
      const result = await supabase.rpc('reconcile_internal_actions');
      if (result.error) throw new Error(result.error.message);
      return { status: 'succeeded', summary: result.data };
    }));
    const failures = runs.filter((run) => ['failed', 'partial', 'skipped'].includes(run.status));
    return NextResponse.json({ ok: failures.length === 0, runs, ...(failures.length ? { message: failures.map((run) => `${run.job}: ${run.error ?? run.status}`).join('; ') } : {}) }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    console.error('[cron/sync-leads]', error);
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Automation could not persist its result.', runs }, { status: 500 });
  }
}