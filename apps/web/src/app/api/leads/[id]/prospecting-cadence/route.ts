import { NextRequest, NextResponse } from 'next/server';
import { agencyEnabled, agentSender } from '../../../../../lib/agency-membership';
import { getApiSession } from '../../../../../lib/api-auth';
import { getOwnGmailConnection } from '../../../../../lib/gmail-provider';
import { prospectingSchedule } from '../../../../../lib/prospecting-schedule';
import { resolveOutboundEmailRecipient } from '../../../../../lib/message-delivery';
import { processDueProspectingEmailDrafts } from '../../../../../lib/prospecting-cadence';
import type { BusinessResearchProfile } from '@crm/shared';
import { prospectingReadiness } from '../../../../../lib/prospecting-evidence';
import { isRecord } from '../../../../../lib/workspace-validation';
import { getOutreachSettings } from '../../../../../lib/outreach-engine';
import { isUuid } from '../../../../../lib/workspace-validation';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { hasTeamPermission, requireTeamPermission, type RequestAccess } from '../../../../../lib/team-request-access';
import { staffRecordScope } from '../../../../../lib/staff-records';

const MIGRATION = '20261113020000_prospecting_cadence';
interface RouteContext { params: Promise<{ id: string }> }
interface CadenceRow {
  id: string;
  lead_id: string;
  agent_user_id: string;
  status: string;
  voicemail_count: number;
  ended_reason: string | null;
  context: { priority?: 'A' | 'B' | 'C'; hook?: string; offer?: string };
}
interface CadenceTouchRow {
  id: string;
  touch_number: number;
  channel: 'call' | 'email';
  due_at: string;
  status: string;
  outcome: string | null;
  voicemail: boolean;
  task_id: string | null;
  outbox_id: string | null;
}

function missingSchema(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204' || error?.code === 'PGRST202';
}

function cadenceError(error: { message: string; code?: string }): WorkspaceError {
  if (!missingSchema(error)) return databaseError(error);
  console.error('[prospecting-cadence/schema]', MIGRATION, error.code, error.message);
  return new WorkspaceError('The prospecting plan is temporarily unavailable. Please try again.', 503);
}

async function loadCadence(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, leadId: string) {
  const { data: cadence, error } = await db.from('prospecting_cadences').select('*')
    .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle<CadenceRow>();
  if (error) throw cadenceError(error);
  if (!cadence) return null;

  const { data: touches, error: touchError } = await db.from('prospecting_cadence_touches')
    .select('id,touch_number,channel,due_at,status,outcome,voicemail,task_id,outbox_id')
    .eq('cadence_id', cadence.id).order('touch_number').returns<CadenceTouchRow[]>();
  if (touchError) throw cadenceError(touchError);

  const outboxIds = (touches ?? []).map((touch) => touch.outbox_id).filter((id): id is string => Boolean(id));
  const outboxRows = outboxIds.length
    ? await db.from('outreach_outbox').select('id,status,error').in('id', outboxIds)
    : { data: [], error: null };
  if (outboxRows.error) throw databaseError(outboxRows.error);
  const outbox = new Map((outboxRows.data ?? []).map((row) => [row.id, row]));
  return {
    ...cadence,
    touches: (touches ?? []).map((touch) => ({
      ...touch,
      email_status: touch.outbox_id ? outbox.get(touch.outbox_id)?.status ?? null : null,
      email_error: touch.outbox_id ? outbox.get(touch.outbox_id)?.error ?? null : null,
    })),
  };
}

async function verifyLeadAccess(
  db: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  actorId: string,
  leadId: string,
  access: RequestAccess | undefined,
) : Promise<{ agent_user_id: string | null }> {
  requireTeamPermission(access, 'leads.view', 'assigned');
  const { data: lead, error } = await db.from('leads').select('id,agent_user_id').eq('id', leadId).maybeSingle();
  if (error) throw databaseError(error);
  const scope = access?.mode === 'legacy' ? 'agency' : staffRecordScope(access, 'leads');
  if (!lead || !scope || (scope === 'assigned' && lead.agent_user_id !== actorId)) {
    throw new WorkspaceError('Lead not found or unavailable.', 404);
  }
  return lead;
}

async function readiness(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string, leadId: string) {
  const [research, lead] = await Promise.all([
    db.rpc('get_record_business_research', { p_actor: actor, p_type: 'lead', p_id: leadId }).single<BusinessResearchProfile>(),
    db.from('leads').select('form_payload,source').eq('id', leadId).single<{ form_payload: unknown; source: string | null }>(),
  ]);
  if (research.error) throw databaseError(research.error);
  if (lead.error) throw databaseError(lead.error);
  const payload = isRecord(lead.data.form_payload) ? lead.data.form_payload : {};
  const profile = isRecord(payload.profile) ? payload.profile : {};
  return { ...prospectingReadiness(research.data, profile.renewals), acquisition_source: lead.data.source };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) throw new WorkspaceError('Sign in before viewing this prospecting plan.', 401);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const { id } = await context.params;
    if (!isUuid(id)) throw new WorkspaceError('Choose a valid lead.', 400);
    await verifyLeadAccess(db, session.user.id, id, session.teamAccess);
    const [cadence, summary] = await Promise.all([loadCadence(db, id), readiness(db, session.user.id, id)]);
    return NextResponse.json({
      cadence,
      readiness: summary,
      can_manage: Boolean(cadence && hasTeamPermission(session.teamAccess, 'campaigns.send')),
      can_cancel: Boolean(cadence && hasTeamPermission(session.teamAccess, 'campaigns.send')),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'prospecting-cadence/read');
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) throw new WorkspaceError('Sign in before starting this prospecting plan.', 401);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const { id } = await context.params;
    if (!isUuid(id)) throw new WorkspaceError('Choose a valid lead.', 400);
    const body = await workspaceBody(request);
    if (body.confirm !== true || Object.keys(body).some((key) => !['confirm', 'priority'].includes(key))
      || (body.priority !== undefined && !['A', 'B', 'C'].includes(String(body.priority)))) {
      throw new WorkspaceError('Confirm that you want to start the eight-touch prospecting plan.', 400);
    }

    requireTeamPermission(session.teamAccess, 'campaigns.send');
    await verifyLeadAccess(db, session.user.id, id, session.teamAccess);
    const contact = await resolveOutboundEmailRecipient(db, { leadId: id });
    if (!contact.ok) throw new WorkspaceError(contact.message, contact.status);
    const settings = await getOutreachSettings(db);
    let mailboxId: string | null = null;
    if (agencyEnabled()) {
      await agentSender(db, session.user.id);
      const mailbox = await getOwnGmailConnection(db, session.user.id);
      if (!mailbox || mailbox.status !== 'connected') {
        throw new WorkspaceError('Connect your Gmail mailbox before starting this prospecting plan.', 409);
      }
      mailboxId = mailbox.id;
    }
    const touches = prospectingSchedule(new Date(), settings.timezone);
    const summary = await readiness(db, session.user.id, id);
    const { error } = await db.rpc('create_prospecting_cadence', {
      p_actor: session.user.id,
      p_lead: id,
      p_mailbox: mailboxId,
      p_touches: touches,
      p_context: {
        ...summary, priority: body.priority ?? summary.suggested_priority,
        hook: summary.signals[0]?.text ?? 'Question-first: confirm the business priority.',
        offer: summary.signals.some((signal) => signal.source === 'FMCSA Census')
          ? 'Vehicle and driver review checklist' : 'Business insurance review checklist',
      },
    });
    if (error) throw cadenceError(error);
    return NextResponse.json({ cadence: await loadCadence(db, id), can_manage: true, can_cancel: true }, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'prospecting-cadence/start');
  }
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) throw new WorkspaceError('Sign in before updating this prospecting plan.', 401);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const { id } = await context.params;
    if (!isUuid(id)) throw new WorkspaceError('Choose a valid lead.', 400);
    requireTeamPermission(session.teamAccess, 'campaigns.send');
    await verifyLeadAccess(db, session.user.id, id, session.teamAccess);
    const body = await workspaceBody(request);
    if (body.action === 'nurture_reminder' && Object.keys(body).length === 1) {
      const summary = await readiness(db, session.user.id, id);
      if (!summary.nurture_on) throw new WorkspaceError('A current confirmed renewal is needed for this reminder.', 409);
      const result = await db.rpc('create_prospecting_nurture', {
        p_actor: session.user.id, p_lead: id, p_due: summary.nurture_on,
      });
      if (result.error) throw databaseError(result.error);
      return NextResponse.json({ cadence: await loadCadence(db, id), message: 'Renewal-preparation reminder saved.' });
    }
    const cadence = await loadCadence(db, id);
    if (!cadence) throw new WorkspaceError('No prospecting plan exists for this lead.', 404);

    if (body.action === 'prepare_drafts' && Object.keys(body).length === 1) {
      if (cadence.status !== 'active') {
        throw new WorkspaceError('Only an active plan can prepare drafts.', 403);
      }
      await processDueProspectingEmailDrafts(db, 4, cadence.id);
    } else if (body.action === 'cancel' && Object.keys(body).length === 1) {
      if (cadence.status !== 'active') throw new WorkspaceError('This prospecting plan is no longer active.', 409);
      const stopped = await db.rpc('stop_prospecting_cadence', {
        p_cadence: cadence.id, p_status: 'cancelled', p_reason: 'Cancelled by the agent.',
      });
      if (stopped.error) throw databaseError(stopped.error);
    } else if (body.action === 'log_call' && Object.keys(body).every((key) => ['action', 'touch_id', 'outcome'].includes(key))) {
      if (typeof body.touch_id !== 'string' || !isUuid(body.touch_id)
        || !cadence.touches.some((touch) => touch.id === body.touch_id)
        || !['connected', 'no_answer', 'voicemail', 'not_interested'].includes(String(body.outcome))) {
        throw new WorkspaceError('Choose a valid call outcome.', 400);
      }
      const completed = await db.rpc('complete_prospecting_call_touch', {
        p_actor: session.user.id, p_touch: body.touch_id, p_outcome: body.outcome,
      });
      if (completed.error) throw databaseError(completed.error);
    } else {
      throw new WorkspaceError('Choose a valid prospecting plan action.', 400);
    }
    const saved = await loadCadence(db, id);
    return NextResponse.json({
      cadence: saved,
      can_manage: Boolean(saved && hasTeamPermission(session.teamAccess, 'campaigns.send')),
      can_cancel: Boolean(saved && hasTeamPermission(session.teamAccess, 'campaigns.send')),
    });
  } catch (error) {
    return workspaceApiError(error, 'prospecting-cadence/update');
  }
}
