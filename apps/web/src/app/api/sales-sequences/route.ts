import { NextRequest, NextResponse } from 'next/server';
import { SALES_SEQUENCE_PRESETS, renderSalesTemplate, type SalesSequencePlan } from '@crm/shared';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled, agentSender } from '../../../lib/agency-membership';
import { getOutreachSender } from '../../../lib/marketing-profile';
import { workspaceApiError, workspaceBody, databaseError } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';
import { isUuid } from '../../../lib/workspace-validation';
import { listSalesTemplates, salesFacts, mergeSalesFacts } from '../../../lib/sales-templates';
import { sequenceEvidence, sequenceTemplate, salesSequenceBlock, parseSalesPlan } from '../../../lib/sales-sequences';
import { getOwnGmailConnection } from '../../../lib/gmail-provider';
import { prepareEnrollmentDraft, type EnrollmentRow } from '../../../lib/outreach-engine';
import { marketingEnvelope, requireMarketingConsent } from '../../../lib/marketing-email';
import { verifiedReplyCheck } from '../../../lib/email-setup';
import { getAgentEmailSender } from '../../../lib/agent-email-sender';

async function access(request: NextRequest) {
  const session = await getApiSession(request);
  if (session.error) throw new WorkspaceError('Sign in before managing sequences.', 401);
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  await activeAgencyMember(db, session.user.id);
  return { db, actor: session.user.id };
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request);
    const lead = request.nextUrl.searchParams.get('lead');
    if (!isUuid(lead)) throw new WorkspaceError('Choose a valid lead.', 400);
    await salesFacts(db, actor, `lead:${lead}`);
    const rows = await db.from('sequence_enrollments').select('id,status,sales_plan,current_step,total_steps,step_gap_days,ended_reason')
      .eq('lead_id', lead).not('sales_plan', 'is', null).order('enrolled_at', { ascending: false }).limit(10);
    if (rows.error) throw databaseError(rows.error);
    const [events, quotes] = await Promise.all([
      db.from('events').select('id,subject,event_date').eq('related_type', 'lead').eq('related_id', lead).eq('status', 'completed').limit(50),
      db.from('quote_options').select('id,carrier,line_of_business').eq('lead_id', lead).in('status', ['presented', 'accepted']).limit(50),
    ]);
    if (events.error) throw databaseError(events.error);
    if (quotes.error) throw databaseError(quotes.error);
    return NextResponse.json({ rows: rows.data, actor, appointments: events.data, quotes: quotes.data },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'sales-sequences/read'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request);
    const body = await workspaceBody(request);
    if (body.email_provider !== undefined && body.email_provider !== 'gmail' && body.email_provider !== 'resend') {
      throw new WorkspaceError('Choose a supported email sender.', 400);
    }
    if (body.auto_send !== undefined && typeof body.auto_send !== 'boolean') throw new WorkspaceError('Choose whether to send the reviewed sequence automatically.', 400);
    if (!isUuid(body.lead_id) || typeof body.preset !== 'string'
      || !Object.hasOwn(SALES_SEQUENCE_PRESETS, body.preset) || body.confirmed !== true
      || !Number.isSafeInteger(body.gap) || typeof body.gap !== 'number' || body.gap < 1 || body.gap > 30) {
      throw new WorkspaceError('Choose a lead, sequence and 1-30 day gap; review and confirm the plan.', 400);
    }
    const preset = body.preset as keyof typeof SALES_SEQUENCE_PRESETS;
    const facts = mergeSalesFacts(await salesFacts(db, actor, `lead:${body.lead_id}`), body.facts);
    const record = await db.from('leads').select('status,email,agent_user_id,archived_at').eq('id', body.lead_id).single();
    if (record.error) throw databaseError(record.error);
    if (record.data.archived_at || ['won', 'lost'].includes(record.data.status)) throw new WorkspaceError('Only open leads can enroll.', 409);
    const useGmail = body.email_provider === 'gmail' || (body.email_provider === undefined && agencyEnabled());
    const sender = await getAgentEmailSender(db, actor);
    const mailbox = useGmail ? await getOwnGmailConnection(db, actor) : null;
    if (useGmail && mailbox?.status !== 'connected') throw new WorkspaceError('Connect your Gmail mailbox in My Account first.', 409);
    const approveAll = useGmail && body.auto_send === true;
    if (body.auto_send === true && !useGmail) throw new WorkspaceError('Choose your Gmail mailbox for an automatically sent reviewed sequence.', 400);
    const templates = await listSalesTemplates(db);
    const plan: SalesSequencePlan = {
      actor, preset, stage: record.data.status, assigned_agent: record.data.agent_user_id ?? null,
      recipient: record.data.email?.trim().toLowerCase() ?? '', sender, facts, auto_send: approveAll,
      evidence: await sequenceEvidence(db, body.lead_id, preset, body.evidence_id),
      steps: SALES_SEQUENCE_PRESETS[preset].templates.map((id, index) => {
        const template = sequenceTemplate(templates, id), rendered = renderSalesTemplate(template, 'email', facts);
        if (rendered.missing.length) throw new WorkspaceError(`Confirm: ${rendered.missing.join(', ')}.`, 400);
        return { template, subject: rendered.subject, body: rendered.body,
          requires_review: !approveAll && (index === 0 || (preset === 'post_appointment' && id !== 'close_loop')) };
      }),
    };
    const block = await salesSequenceBlock(db, body.lead_id, plan);
    if (block) throw new WorkspaceError(block, 409);
    if (approveAll) marketingEnvelope(plan.recipient, '');
    const saved = await db.rpc(useGmail ? 'enroll_personal_gmail_sales_sequence' : 'enroll_sales_sequence', { p_actor: actor, p_lead: body.lead_id,
      p_plan: { ...plan, mailbox: mailbox?.id ?? null }, p_gap: body.gap }).single<EnrollmentRow>();
    if (saved.error?.code === '23505') throw new WorkspaceError('A sequence already exists for this lead. Review it before enrolling again.', 409);
    if (saved.error) throw databaseError(saved.error);
    if (!saved.data) throw new WorkspaceError('Sequence enrollment was not confirmed.', 500);
    await prepareEnrollmentDraft(db, saved.data);
    return NextResponse.json({ id: saved.data.id, message: approveAll
      ? 'Reviewed sequence queued from your Gmail. You can pause or cancel it here.'
      : 'Sequence created. Review the first email in Outreach before sending.' }, { status: 201 });
  } catch (error) { return workspaceApiError(error, 'sales-sequences/enroll'); }
}
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request);
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || !['enable_auto', 'disable_auto', 'pause', 'resume', 'cancel'].includes(String(body.action))) throw new WorkspaceError('Choose a sequence action.', 400);
    const row = await db.from('sequence_enrollments').select('lead_id,sales_plan,enrolled_at,gmail_connection_id').eq('id', body.id).single();
    if (row.error) throw databaseError(row.error);
    const plan = parseSalesPlan(row.data.sales_plan);
    if (plan.actor !== actor) throw new WorkspaceError('Only the sequence owner can change sending state.', 403);
    if (body.action === 'enable_auto' || body.action === 'resume') {
      if (body.action === 'enable_auto' && body.confirmed !== true) throw new WorkspaceError('Explicitly approve automatic sending for this enrollment.', 400);
      const block = await salesSequenceBlock(db, row.data.lead_id, plan, row.data.enrolled_at);
      if (block) throw new WorkspaceError(block, 409);
      const mailbox = row.data.gmail_connection_id ? await getOwnGmailConnection(db, actor) : null;
      if (row.data.gmail_connection_id && (mailbox?.status !== 'connected' || mailbox.id !== row.data.gmail_connection_id)) {
        throw new WorkspaceError('Reconnect your Gmail mailbox before resuming or enabling automatic sending.', 409);
      }
      if (body.action === 'enable_auto') {
        if (!row.data.gmail_connection_id) await requireMarketingConsent(db, plan.recipient);
        marketingEnvelope(plan.recipient, '');
        if (!row.data.gmail_connection_id && process.env.RESEND_REPLY_SYNC_READY !== 'true' && !(await verifiedReplyCheck(db))) {
          throw new WorkspaceError('Verify reply syncing in Settings > Email before enabling automatic sending.', 409);
        }
      }
    }
    const saved = await db.rpc('set_sales_sequence_state', { p_actor: actor, p_id: body.id, p_action: body.action });
    if (saved.error) throw databaseError(saved.error);
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'sales-sequences/state'); }
}
