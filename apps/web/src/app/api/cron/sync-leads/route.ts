import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { isArizonaWeekend, nextArizonaBusinessMorning, startOfArizonaDay } from '../../../../lib/arizona-time';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { applyResubmission } from '../../../../lib/resubmission';
import { scheduleIntakeTask } from '../../../../lib/intake-task';
import { sourceSubmissionId } from '../../../../lib/website-intake';

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

  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  if (userAgent.includes('vercel-cron')) return true;

  return !cronSecret;
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

interface RoutineLeadRow {
  id: string;
  full_name: string;
  status: string | null;
}

/** Stage-aware wording so every task names the person and the actual next step. */
function followUpTaskFor(lead: RoutineLeadRow): { subject: string; description: string } {
  const name = lead.full_name?.trim() || 'this prospect';
  const status = (lead.status ?? 'new').toLowerCase();
  if (status === 'quoted') {
    return {
      subject: `Follow up on ${name}'s quote`,
      description: `${name} has a quote in hand but hasn't moved. Ask where they stand and what it would take to close.`,
    };
  }
  if (status === 'contacted') {
    return {
      subject: `Follow up with ${name}`,
      description: `You've already reached out to ${name} — keep the conversation moving with a call or a short note.`,
    };
  }
  return {
    subject: `Make first contact with ${name}`,
    description: `${name} is still untouched in your pipeline. Introduce yourself and qualify their interest.`,
  };
}

async function enforceDefaultFollowUpRoutine(): Promise<{ created: number }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { created: 0 };
  }

  const now = new Date();
  if (isArizonaWeekend(now)) {
    return { created: 0 };
  }

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id,full_name,status')
    .in('status', ['new', 'contacted', 'quoted']);

  if (leadsError || !leads || leads.length === 0) {
    return { created: 0 };
  }

  // Skip leads that already have an open scheduled task.
  const { data: existingRows, error: existingError } = await supabase
    .from('tasks')
    .select('related_id')
    .eq('status', 'open')
    .eq('related_type', 'lead')
    .not('due_date', 'is', null)
    .gte('due_date', startOfArizonaDay(now).toISOString());

  if (existingError) {
    return { created: 0 };
  }

  const existingLeadIds = new Set(
    (existingRows ?? [])
      .map((row) => asString((row as { related_id?: unknown }).related_id))
      .filter((value): value is string => Boolean(value)),
  );

  const targetDate = nextArizonaBusinessMorning(now);

  const inserts = (leads as RoutineLeadRow[])
    .filter((lead) => !existingLeadIds.has(lead.id))
    .map((lead) => {
      const wording = followUpTaskFor(lead);
      return {
        subject: wording.subject,
        description: wording.description,
        due_date: targetDate.toISOString(),
        status: 'open',
        priority: 'medium',
        related_type: 'lead',
        related_id: lead.id,
        created_at: now.toISOString(),
      };
    });

  if (inserts.length === 0) {
    return { created: 0 };
  }

  const { error: insertError } = await supabase.from('tasks').insert(inserts);
  if (insertError) {
    return { created: 0 };
  }

  return { created: inserts.length };
}

/**
 * The export returns ALL submissions every time, so each one is identified by
 * its website id (falling back to its submission timestamp). A submission is
 * processed only once, even after it is archived by a later resubmission.
 */
function externalIdOf(payload: Record<string, unknown>): string | null {
  return sourceSubmissionId(payload);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  // Scheduled runs authorize via CRON_SECRET/vercel-cron; a logged-in producer
  // can also trigger a pull on demand by visiting this route.
  if (!isAuthorizedCron(request)) {
    const sessionError = await requireApiSession(request);
    if (sessionError) return sessionError;
  }

  const followUpRoutine = await enforceDefaultFollowUpRoutine();

  // Piggyback the outreach engine on the daily cron so due sequence steps get
  // drafted even if nobody presses "Run engine now" (best-effort).
  try {
    const outreach = await processDueEnrollments(supabase);
    console.log('[cron/sync-leads] outreach engine', outreach);
  } catch (error) {
    console.error('[cron/sync-leads] outreach engine failed', error);
  }

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
        followUpsCreated: followUpRoutine.created,
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
      { ok: true, pulled: 0, inserted: 0, resubmissions: 0, skippedExisting: 0, followUpsCreated: followUpRoutine.created },
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
      followUpsCreated: followUpRoutine.created,
      ...(errors.length > 0 ? { errors: errors.slice(0, 5) } : {}),
    },
    { status: 200 },
  );
}