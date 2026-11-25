/**
 * Outreach sequence engine. A lead enrolled in a sequence receives a short
 * series of AI-drafted, fact-grounded emails (default 3, ~5 days apart).
 * Drafts land in an approval outbox; a reply or opt-out stops the sequence
 * immediately and raises a call task.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_OUTREACH_SENDER, EMPTY_MARKETING_PROFILE, isOutreachTemplate, hasUnresolvedSalesFields, parseEmailDesign, emailContentKey, type SalesTemplateSnapshot, type MarketingProfile, type OutreachSender, type WorkspaceAsset, type WorkspaceNote } from '@crm/shared';
import { parseSalesPlan, salesSequenceBlock } from './sales-sequences';
import { parseOutreachSender } from './marketing-profile';
import { leadOutreachContext } from './lead-outreach-context';
import { draftSequenceStep } from './outreach-ai';
import { sendOutboundEmail } from './email-adapter';
import { DEFAULT_AGENCY_TIME_ZONE, agencyHour, isAgencyTimeZone, nextAgencyBusinessMorning, startOfAgencyDay } from './agency-time';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { agencyEnabled, agentSender, activeAgencyMember } from './agency-membership';
import { getOwnGmailConnection } from './gmail-provider';
import { sendAgentEmail } from './agent-email';
import { WorkspaceError } from './record-scope';
import { marketingEnvelope, requireMarketingConsent } from './marketing-email';
import { verifiedReplyCheck } from './email-setup';
import { databaseError } from './workspace-api';
import { isUuid } from './workspace-validation';
import { getAgentEmailSender } from './agent-email-sender';
import { assertOutreachSendAccess } from './agent-scheduled';

export interface OutreachSettings {
  approval_mode: boolean;
  daily_send_cap: number;
  send_window_start: number;
  send_window_end: number;
  timezone?: string;
  opt_out_footer: string;
  sender_profile: OutreachSender;
}

export interface EnrollmentRow {
  sales_plan?: unknown;
  workflow_rule_id?: string | null;
  workflow_execution_id?: string | null;
  agent_user_id?: string | null;
  gmail_connection_id?: string | null;
  template?: string;
  auto_send_enabled?: boolean;
  approved_sender?: unknown;
  approved_recipient?: string | null;
  id: string;
  lead_id: string;
  status: string;
  current_step: number;
  total_steps: number;
  step_gap_days: number;
  next_send_at: string | null;
  last_sent_at: string | null;
  enrolled_at: string;
}

export interface OutboxRow {
  prospecting_touch_id?: string | null;
  sales_template?: SalesTemplateSnapshot | null;
  agent_user_id?: string | null;
  gmail_connection_id?: string | null;
  id: string;
  enrollment_id: string | null;
  lead_id: string;
  step_number: number;
  to_email: string;
  subject: string;
  body: string;
  cited_signals: string[];
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  provider?: string | null;
}

interface LeadRow {
  marketing_profile?: MarketingProfile;
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  source: string | null;
  status: string | null;
  form_payload: Record<string, unknown> | null;
  workspace_assets?: WorkspaceAsset[];
  workspace_notes?: WorkspaceNote[];
}

export async function getOutreachSettings(supabase: SupabaseClient): Promise<OutreachSettings> {
  const { data, error } = await supabase.from('outreach_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`Unable to load outreach settings: ${error.message}`);
  const timezone = data?.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
  if (!isAgencyTimeZone(timezone)) throw new Error('The saved agency time zone is invalid. Contact your administrator.');
  return {
    approval_mode: data?.approval_mode ?? true,
    daily_send_cap: data?.daily_send_cap ?? 20,
    send_window_start: data?.send_window_start ?? 8,
    send_window_end: data?.send_window_end ?? 17,
    timezone,
    opt_out_footer:
      data?.opt_out_footer ??
      'If you\u2019d prefer not to receive these emails, reply "unsubscribe" and we\u2019ll remove you right away. Shield Assurance, Tucson, AZ.',
    sender_profile: data?.sender_profile ? parseOutreachSender(data.sender_profile) : DEFAULT_OUTREACH_SENDER,
  };
}

export async function isOptedOut(supabase: SupabaseClient, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const { data, error } = await supabase.from('outreach_opt_outs').select('email').eq('email', normalized).maybeSingle();
  if (error) throw new Error(`Unable to verify outreach opt-outs: ${error.message}`);
  return Boolean(data);
}

export async function sentTodayCount(supabase: SupabaseClient, timeZone = DEFAULT_AGENCY_TIME_ZONE): Promise<number> {
  const dayStart = startOfAgencyDay(new Date(), timeZone).toISOString();
  const { count, error } = await supabase
    .from('outreach_outbox')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'accepted_by_provider', 'sending', 'acceptance_unknown'])
    .gte('sent_at', dayStart);
  if (error) throw new Error(`Unable to check today's outreach count: ${error.message}`);
  return count ?? 0;
}

function inSendWindow(settings: OutreachSettings, now: Date): boolean {
  const localHour = agencyHour(now, settings.timezone ?? DEFAULT_AGENCY_TIME_ZONE);
  return localHour >= settings.send_window_start && localHour < settings.send_window_end;
}

async function fetchLead(supabase: SupabaseClient, leadId: string, actorId?: string): Promise<LeadRow | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('id,full_name,email,phone,address,line_of_business,source,status,form_payload')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();
  if (error) throw new Error(`Unable to load the lead for outreach: ${error.message}`);
  return data ? { ...data, ...await leadOutreachContext(supabase, leadId, actorId) } : null;
}

/**
 * Starts a sequence for a lead. Generates the first draft right away so the
 * producer immediately has something to review in the outbox.
 */
export async function enrollLead(
  supabase: SupabaseClient,
  leadId: string,
  actorId?: string,
  workflow?: { jobId: string; ruleId: string; draft: boolean; deadline?: number },
): Promise<{ enrollment?: EnrollmentRow; drafted: boolean; message?: string }> {
  const lead = await fetchLead(supabase, leadId, actorId);
  if (!lead) return { drafted: false, message: 'Lead not found.' };

  const email = (lead.email ?? '').trim().toLowerCase();
  if (!email) return { drafted: false, message: 'This lead has no email address — add one before enrolling.' };
  const allowed = await resolveOutboundEmailRecipient(supabase, { leadId, to: email });
  if (!allowed.ok) return { drafted: false, message: allowed.message };
  const cadence = await supabase.from('prospecting_cadences').select('id').eq('lead_id', leadId).eq('status', 'active').limit(1);
  if (cadence.error) throw databaseError(cadence.error);
  if (cadence.data?.length) throw new WorkspaceError('Cancel the active prospecting plan before starting a separate email sequence.', 409);

  const existing = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused'])
    .maybeSingle();
  if (existing.error) throw new Error(`Unable to check enrollment: ${existing.error.message}`);
  if (existing.data && !workflow) {
    if (existing.data.status === 'active') {
      if (agencyEnabled() && existing.data.agent_user_id !== actorId) throw new WorkspaceError('Only the sequence owner can retry its draft.', 403);
      const enrollment = existing.data as EnrollmentRow;
      const drafted = await generateStepDraft(supabase, enrollment, lead);
      return { enrollment, drafted, message: drafted
        ? 'The missing email draft is now waiting in the outbox for your approval.'
        : 'This sequence already has a draft or recorded attempt for its current step. Review it in Outreach.' };
    }
    return { drafted: false, message: `Already enrolled (${existing.data.status}).` };
  }
  const mailbox = agencyEnabled() && actorId ? await getOwnGmailConnection(supabase, actorId) : null;
  if (agencyEnabled() && (!actorId || !mailbox || mailbox.status !== 'connected')) throw new WorkspaceError('Connect your Gmail mailbox before enrolling.', 409);
  if (workflow) {
    const enrolled = await supabase.rpc('enroll_workflow_sequence', {
      p_job: workflow.jobId, p_agent: actorId, p_mailbox: mailbox?.id ?? null,
      p_sender: agencyEnabled() && actorId ? await agentSender(supabase, actorId) : null, p_recipient: email,
    }).single<EnrollmentRow>();
    if (enrolled.error) throw databaseError(enrolled.error);
    if (!enrolled.data || !isUuid(enrolled.data.id) || enrolled.data.lead_id !== leadId || enrolled.data.status !== 'active'
      || enrolled.data.workflow_rule_id !== workflow.ruleId || enrolled.data.workflow_execution_id !== workflow.jobId) {
      throw new Error('Workflow enrollment returned no verified sequence or approval provenance.');
    }
    const drafted = workflow.draft ? await generateStepDraft(supabase, enrolled.data, lead, workflow.deadline) : false;
    return { enrollment: enrolled.data, drafted };
  }

  const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert([{ lead_id: leadId, status: 'active', next_send_at: new Date().toISOString(),
      ...(agencyEnabled() ? { agent_user_id: actorId, gmail_connection_id: mailbox?.id, approved_sender: await agentSender(supabase, actorId ?? ''), approved_recipient: email } : {}),
    }])
    .select('*')
    .single<EnrollmentRow>();
  if (error || !enrollment) throw new Error(error?.message ?? 'Failed to enroll.');

  const drafted = await generateStepDraft(supabase, enrollment, lead);
  return { enrollment, drafted };
}

/** Drafts the next step for an enrollment into the outbox (idempotent per step). */
async function generateStepDraft(
  supabase: SupabaseClient,
  enrollment: EnrollmentRow,
  lead: LeadRow,
  deadline?: number,
): Promise<boolean> {
  const step = enrollment.current_step + 1;

  const pending = await supabase
    .from('outreach_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', enrollment.id)
    .eq('step_number', step);
  if (pending.error) throw new Error(`Unable to check existing drafts: ${pending.error.message}`);
  if ((pending.count ?? 0) > 0) return false;

  const prior = await supabase
    .from('outreach_outbox')
    .select('subject,body')
    .eq('enrollment_id', enrollment.id)
    .eq('status', 'sent')
    .order('sent_at', { ascending: true });
  if (prior.error) throw new Error(`Unable to load prior outreach: ${prior.error.message}`);

  const draftLead = agencyEnabled() && isOutreachTemplate(enrollment.template)
    ? { ...lead, marketing_profile: { ...(lead.marketing_profile ?? EMPTY_MARKETING_PROFILE), template: enrollment.template } } : lead;
  const salesPlan = enrollment.sales_plan ? parseSalesPlan(enrollment.sales_plan) : null;
  const salesStep = salesPlan?.steps[step - 1];
  if (salesPlan && !salesStep) throw new WorkspaceError('No reviewed sales template exists for this step. Review and recreate the sequence.', 409);
  const draft = salesStep && salesPlan ? { subject: salesStep.subject, body: `${salesStep.body}\n\n-- \n${salesPlan.sender.signature}`, cited_signals: [`Agent-reviewed sales template ${salesStep.template.id} v${salesStep.template.revision}`] }
    : await draftSequenceStep(draftLead, step, enrollment.total_steps, prior.data ?? [], deadline);
  if (!draft) throw new Error('AI drafting is unavailable. No outreach draft was saved.');

  const { data, error } = await supabase.rpc('create_outreach_draft', {
    p_enrollment_id: enrollment.id, p_step: step,
    p_to: (lead.email ?? '').trim().toLowerCase(), p_subject: draft.subject,
    p_body: draft.body, p_signals: draft.cited_signals,
  });
  if (error) throw new Error(`Unable to save outreach draft: ${error.message}`);
  if (typeof data !== 'boolean') throw new Error('Draft creation returned an invalid result.');
  return data;
}
export async function prepareEnrollmentDraft(db: SupabaseClient, enrollment: EnrollmentRow): Promise<boolean> {
  const actor = enrollment.sales_plan ? parseSalesPlan(enrollment.sales_plan).actor : enrollment.agent_user_id ?? undefined;
  const lead = await fetchLead(db, enrollment.lead_id, actor);
  if (!lead) throw new WorkspaceError('Lead not found.', 404);
  return generateStepDraft(db, enrollment, lead);
}

/**
 * Processes all enrollments whose next send is due: drafts the next step into
 * the outbox, and auto-sends when approval mode is off (within the send window
 * and under the daily cap).
 */
export async function processDueEnrollments(
  supabase: SupabaseClient,
  batch?: { limit: number; after: string | null; gmailOnly?: boolean },
): Promise<{ drafted: number; autoSent: number; skipped: number; next_cursor?: string | null }> {
  const settings = await getOutreachSettings(supabase);
  const now = new Date();

  let acceptedQuery = supabase.from('outreach_outbox').select('id').eq('status', 'accepted_by_provider');
  if (batch?.gmailOnly) acceptedQuery = acceptedQuery.not('gmail_connection_id', 'is', null);
  const { data: accepted, error: recoveryError } = await acceptedQuery.limit(batch ? 10 : 50);
  if (recoveryError) throw new Error(`Unable to load accepted outreach for recovery: ${recoveryError.message}`);
  for (const item of accepted ?? []) await finalizeAcceptedOutbox(supabase, item.id);

  let query = supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', now.toISOString());
  if (batch?.after) query = query.gt('id', batch.after);
  if (batch?.gmailOnly) query = query.not('gmail_connection_id', 'is', null).not('sales_plan', 'is', null)
    .eq('sales_plan->>auto_send', 'true');
  const { data: due, error: dueError } = await query.order('id').limit(batch?.limit ?? 50);
  if (dueError) throw new Error(`Unable to load due enrollments: ${dueError.message}`);

  let drafted = 0;
  let autoSent = 0;
  let skipped = 0;

  for (const enrollment of (due ?? []) as EnrollmentRow[]) {
    const salesPlan = enrollment.sales_plan ? parseSalesPlan(enrollment.sales_plan) : null;
    if (salesPlan) {
      const reason = await salesSequenceBlock(supabase, enrollment.lead_id, salesPlan, enrollment.enrolled_at);
      if (reason) {
        const paused = await supabase.from('sequence_enrollments').update({ status: 'paused', ended_reason: reason,
          sales_plan: { ...salesPlan, auto_send: false } }).eq('id', enrollment.id).eq('status', 'active');
        if (paused.error) throw databaseError(paused.error);
        skipped++; continue;
      }
    }
    if (enrollment.gmail_connection_id) {
      if (!enrollment.agent_user_id) { skipped += 1; continue; }
      const owner = await supabase.from('agency_members').select('active').eq('user_id', enrollment.agent_user_id).maybeSingle();
      if (owner.error) throw new Error(owner.error.message);
      if (!owner.data?.active) { skipped += 1; continue; }
    }
    const lead = await fetchLead(supabase, enrollment.lead_id, salesPlan?.actor ?? enrollment.agent_user_id ?? undefined);
    if (!lead || !lead.email) {
      skipped += 1;
      continue;
    }
    const contact = await resolveOutboundEmailRecipient(supabase, { leadId: lead.id, to: lead.email });
    if (!contact.ok) {
      if (contact.status >= 500) throw new Error(contact.message);
      const state = contact.code === 'opted_out' ? 'opted_out' : 'cancelled';
      const { error } = await supabase.from('sequence_enrollments')
        .update({ status: state, ended_at: now.toISOString(), ended_reason: contact.message })
        .eq('id', enrollment.id).eq('status', 'active');
      if (error) throw new Error(`Unable to stop blocked enrollment: ${error.message}`);
      skipped += 1;
      continue;
    }

    // Stop sequences for leads that moved past prospecting.
    if (lead.status === 'won' || lead.status === 'lost') {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'cancelled', ended_at: now.toISOString(), ended_reason: `Lead marked ${lead.status}.` })
        .eq('id', enrollment.id).eq('status', 'active');
      if (error) throw new Error(`Unable to cancel enrollment: ${error.message}`);
      skipped += 1;
      continue;
    }

    const created = await generateStepDraft(supabase, enrollment, lead, batch ? Date.now() + 20000 : undefined);
    if (created) drafted += 1;

    if ((salesPlan ? salesPlan.auto_send : !agencyEnabled() ? !settings.approval_mode : enrollment.auto_send_enabled === true) && inSendWindow(settings, now)) {
      if (enrollment.gmail_connection_id) {
        const sender = await getAgentEmailSender(supabase, enrollment.agent_user_id ?? '');
        if (!salesPlan) await requireMarketingConsent(supabase, lead.email);
        if (enrollment.approved_recipient !== lead.email.trim().toLowerCase()
          || emailContentKey(sender) !== emailContentKey(salesPlan?.sender ?? enrollment.approved_sender)) { skipped += 1; continue; }
      }
      const sentToday = await sentTodayCount(supabase, settings.timezone ?? DEFAULT_AGENCY_TIME_ZONE);
      if (sentToday >= settings.daily_send_cap) continue;
      const { data: item, error } = await supabase
        .from('outreach_outbox')
        .select('*')
        .eq('enrollment_id', enrollment.id)
        .eq('step_number', enrollment.current_step + 1)
        .eq('status', 'pending_approval')
        .maybeSingle<OutboxRow>();
      if (error) throw new Error(`Unable to load outreach draft: ${error.message}`);
      if (item) {
        if (salesPlan && salesPlan.steps[item.step_number - 1]?.requires_review) { skipped++; continue; }
        try {
          const result = await sendOutboxItem(supabase, item.id, undefined, salesPlan?.actor ?? enrollment.agent_user_id ?? undefined);
          if (result.sent) autoSent += 1;
        } catch (error) {
          if (!(error instanceof WorkspaceError) || error.status !== 403) throw error;
          const paused = await supabase.from('sequence_enrollments').update({ status: 'paused', ended_reason: error.message,
            ...(salesPlan ? { sales_plan: { ...salesPlan, auto_send: false } } : { auto_send_enabled: false }),
          }).eq('id', enrollment.id).eq('status', 'active');
          if (paused.error) throw databaseError(paused.error);
          skipped++;
        }
      }
    }
  }

  return { drafted, autoSent, skipped, ...(batch ? { next_cursor: due?.length === batch.limit ? due[due.length - 1].id as string : null } : {}) };
}

/**
 * Claim before contacting the provider. A crashed/ambiguous attempt is never
 * automatically resent. Known acceptance can retry transactional bookkeeping.
 * Legacy "sent" means provider acceptance, not proof of recipient delivery.
 */
export async function sendOutboxItem(
  supabase: SupabaseClient,
  outboxId: string,
  overrides?: { subject?: string; body?: string; revision?: number },
  actorId?: string,
): Promise<{ sent: boolean; message?: string; deliveryStatus?: 'accepted_by_provider' }> {
  const { data: item, error: loadError } = await supabase.from('outreach_outbox').select('*').eq('id', outboxId).maybeSingle<OutboxRow>();
  if (loadError) throw new Error(`Unable to load outbox item: ${loadError.message}`);
  if (!item) return { sent: false, message: 'Outbox item not found.' };
  if (item.prospecting_touch_id && (!actorId || item.agent_user_id !== actorId || overrides?.revision === undefined)) {
    throw new WorkspaceError('Only the plan owner can review and approve this prospecting draft.', 403);
  }
  if (item.gmail_connection_id) {
    if (!actorId || item.agent_user_id !== actorId) return { sent: false, message: 'Only the sequence owner can manage this mailbox send.' };
    await activeAgencyMember(supabase, actorId);
    if (['sending', 'acceptance_unknown', 'pending_approval'].includes(item.status)) {
      const recorded = await supabase.from('agent_email_attempts').select('status,provider_message_id,provider_thread_id,accepted_at').eq('id', item.id).maybeSingle();
      if (recorded.error) throw new Error(recorded.error.message);
      if (recorded.data?.status === 'recorded') {
        const saved = await supabase.from('outreach_outbox').update({ status: 'accepted_by_provider', provider: 'gmail', sent_at: recorded.data.accepted_at,
          provider_message_id: recorded.data.provider_message_id, provider_thread_id: recorded.data.provider_thread_id }).eq('id', item.id);
        if (saved.error) throw new Error(saved.error.message);
        return finalizeAcceptedOutbox(supabase, item.id);
      }
    }
  }
  if (item.status === 'sent') return { sent: false, deliveryStatus: 'accepted_by_provider', message: 'Already accepted by the email provider; delivery is not confirmed.' };
  if (item.status === 'accepted_by_provider') return finalizeAcceptedOutbox(supabase, item.id);
  if (item.status !== 'pending_approval') {
    return { sent: false, message: 'This item cannot be sent. A prior or uncertain attempt must be reconciled with the provider before any retry.' };
  }
  if (actorId) await assertOutreachSendAccess(supabase, actorId, item.lead_id);
  if (hasUnresolvedSalesFields(overrides?.subject ?? item.subject) || hasUnresolvedSalesFields(overrides?.body ?? item.body)) {
    throw new WorkspaceError('Complete the template details before sending.', 400);
  }
  if (item.sales_template) {
    const enrollment = await supabase.from('sequence_enrollments').select('sales_plan,enrolled_at').eq('id', item.enrollment_id).single();
    if (enrollment.error) throw databaseError(enrollment.error);
    const plan = parseSalesPlan(enrollment.data.sales_plan);
    if (actorId !== plan.actor) throw new WorkspaceError('Only the sequence owner can approve this sales message.', 403);
    const block = await salesSequenceBlock(supabase, item.lead_id, plan, enrollment.data.enrolled_at);
    if (block) throw new WorkspaceError(block, 409);
    const step = plan.steps[item.step_number - 1];
    if (!step || item.sales_template.id !== step.template.id || item.sales_template.revision !== step.template.revision
      || JSON.stringify(parseEmailDesign(item.sales_template.email_design)) !== JSON.stringify(step.template.email_design)) {
      throw new WorkspaceError('The approved template design changed. Review and recreate the sequence.', 409);
    }
  }
  if (!item.gmail_connection_id || !item.sales_template) await requireMarketingConsent(supabase, item.to_email);
  if (!item.gmail_connection_id && process.env.RESEND_REPLY_SYNC_READY !== 'true' && !(await verifiedReplyCheck(supabase))) {
    throw new WorkspaceError('Verify reply syncing in Settings > Email: send the test, reply to it, then refresh status.', 409);
  }
  if (item.gmail_connection_id) {
    if (!actorId || item.agent_user_id !== actorId) return { sent: false, message: 'Only the sequence owner can approve a send from their mailbox.' };
    await activeAgencyMember(supabase, actorId);
    const mailbox = await getOwnGmailConnection(supabase, actorId);
    if (!mailbox || mailbox.id !== item.gmail_connection_id) return { sent: false, message: 'The approved mailbox is unavailable; reauthorize the sequence.' };
    const target = await resolveOutboundEmailRecipient(supabase, { leadId: item.lead_id, to: item.to_email });
    if (!target.ok) return { sent: false, message: target.message };
    const settings = await getOutreachSettings(supabase);
    const subject = overrides?.subject?.trim() || item.subject;
    const envelope = marketingEnvelope(item.to_email, `${overrides?.body?.trim() || item.body}\n\n--\n${settings.opt_out_footer}`);
    const body = envelope.body;
    const claim = await supabase.rpc('claim_outreach_send', { p_outbox_id: item.id, p_subject: subject, p_body: body,
      p_expected_revision: overrides?.revision ?? null });
    if (claim.error) throw new Error(claim.error.message);
    if (claim.data !== true) return { sent: false, message: 'This sequence stopped, a send limit was reached, or another request already claimed the draft.' };
    try {
      await assertOutreachSendAccess(supabase, actorId, item.lead_id);
    } catch (error) {
      const saved = await supabase.from('outreach_outbox').update({ status: 'pending_approval', sent_at: null,
        error: error instanceof Error ? error.message : 'Unable to verify outreach permission.' }).eq('id', item.id).eq('status', 'sending');
      if (saved.error) throw new Error('Outreach authorization failed and the claim could not be released.');
      throw error;
    }
    let result: { id: string };
    let dispatchDenied: { error: unknown } | undefined;
    try {
      result = await sendAgentEmail(supabase, actorId, { to: target.recipient.to, subject, body, headers: envelope.headers },
        { attemptId: item.id, clientId: target.recipient.clientId, leadId: item.lead_id,
          ...(item.sales_template ? { salesTemplate: item.sales_template } : {}) },
        async () => {
          try {
            const current = await resolveOutboundEmailRecipient(supabase, { leadId: item.lead_id, to: item.to_email });
            if (!current.ok) throw new WorkspaceError(current.message, current.status);
            if (current.recipient.to !== target.recipient.to || current.recipient.clientId !== target.recipient.clientId
              || current.recipient.leadId !== target.recipient.leadId) {
              throw new WorkspaceError('The recipient or linked record changed. Review the outreach before sending.', 409);
            }
            if (!item.sales_template) await requireMarketingConsent(supabase, item.to_email);
            await assertOutreachSendAccess(supabase, actorId, item.lead_id);
          }
          catch (error) { dispatchDenied = { error }; throw error; }
        });
    } catch (error) {
      const limited = error instanceof WorkspaceError && error.status === 429;
      const denied = dispatchDenied !== undefined && dispatchDenied.error === error;
      const saved = await supabase.from('outreach_outbox').update({ status: limited || denied ? 'pending_approval' : 'acceptance_unknown',
        ...(limited || denied ? { sent_at: null } : {}),
        error: limited ? error.message : denied && error instanceof Error ? error.message
          : 'Email sending was not confirmed. Check Gmail Sent before retrying.' }).eq('id', item.id).eq('status', 'sending');
      if (saved.error) throw new Error('Agent send state could not be saved; do not resend.');
      throw error;
    }
    const attempt = await supabase.from('agent_email_attempts').select('provider_message_id,provider_thread_id').eq('id', item.id).single();
    if (attempt.error) throw new Error(attempt.error.message);
    const accepted = await supabase.from('outreach_outbox').update({ status: 'accepted_by_provider', provider: 'gmail',
      provider_message_id: attempt.data.provider_message_id, provider_thread_id: attempt.data.provider_thread_id, sent_at: new Date().toISOString() })
      .eq('id', item.id).eq('status', 'sending').select('id').single();
    if (accepted.error) throw new Error('Gmail accepted the email, but the sequence could not be updated. Do not resend.');
    if (!result.id) throw new Error('Gmail acceptance recording is incomplete.');
    return finalizeAcceptedOutbox(supabase, item.id);
  }

  const settings = await getOutreachSettings(supabase);
  const subject = overrides?.subject?.trim() || item.subject;
  const bodyCore = overrides?.body?.trim() || item.body;
  const envelope = marketingEnvelope(item.to_email, `${bodyCore}\n\n--\n${settings.opt_out_footer}`);
  const body = envelope.body;
  const target = await resolveOutboundEmailRecipient(supabase, { leadId: item.lead_id, to: item.to_email });
  if (!target.ok) {
    if (target.status >= 500) throw new Error(target.message);
    return { sent: false, message: target.message };
  }
  const { data: claimed, error: claimError } = await supabase.rpc('claim_outreach_send', {
    p_outbox_id: outboxId, p_subject: subject, p_body: body, p_expected_revision: overrides?.revision ?? null,
  });
  if (claimError) throw new Error(`Unable to claim outreach send: ${claimError.message}`);
  if (claimed !== true) return { sent: false, message: 'The draft is no longer sendable or another request claimed it.' };

  const rechecked = await resolveOutboundEmailRecipient(supabase, { leadId: item.lead_id, to: item.to_email });
  if (!rechecked.ok) {
    const { error } = await supabase.from('outreach_outbox')
      .update({ status: 'rejected', error: rechecked.message, sent_at: null }).eq('id', outboxId).eq('status', 'sending');
    if (error) throw new Error(`Consent blocked the send, but that result could not be saved: ${error.message}`);
    if (rechecked.status >= 500) throw new Error(rechecked.message);
    return { sent: false, message: rechecked.message };
  }
  if (actorId) {
    try {
      await assertOutreachSendAccess(supabase, actorId, item.lead_id);
    } catch (error) {
      const saved = await supabase.from('outreach_outbox').update({ status: 'pending_approval', sent_at: null,
        error: error instanceof Error ? error.message : 'Unable to verify outreach permission.' }).eq('id', outboxId).eq('status', 'sending');
      if (saved.error) throw new Error('Outreach authorization failed and the claim could not be released.');
      throw error;
    }
  }

  let provider: string;
  try {
    await requireMarketingConsent(supabase, rechecked.recipient.to);
    provider = await sendOutboundEmail({ to: rechecked.recipient.to, subject, body, headers: envelope.headers,
      emailDesign: item.sales_template?.email_design,
      purpose: 'marketing', requestId: `outreach:${item.id}`, leadId: item.lead_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email provider acceptance could not be established.';
    const { error: saveError } = await supabase.from('outreach_outbox')
      .update({ status: 'acceptance_unknown', error: message }).eq('id', outboxId).eq('status', 'sending');
    if (saveError) throw new Error(`Provider acceptance is uncertain and could not be recorded; do not resend: ${saveError.message}`);
    throw new Error(`Provider acceptance is uncertain; do not resend until reconciled: ${message}`);
  }

  const { data: accepted, error: acceptanceError } = await supabase
    .from('outreach_outbox')
    .update({ status: 'accepted_by_provider', provider, sent_at: new Date().toISOString(), error: null })
    .eq('id', outboxId).eq('status', 'sending').select('id').maybeSingle();
  if (acceptanceError || !accepted) {
    if (!acceptanceError && provider === 'resend') {
      const recovered = await supabase.from('outreach_outbox').select('status,provider').eq('id', outboxId).maybeSingle();
      if (!recovered.error && recovered.data?.provider === 'resend' && ['accepted_by_provider', 'sent'].includes(recovered.data.status)) {
        return finalizeAcceptedOutbox(supabase, outboxId);
      }
    }
    throw new Error(`Email accepted by provider, but acceptance could not be saved; do not resend: ${acceptanceError?.message ?? 'send state changed'}`);
  }
  return finalizeAcceptedOutbox(supabase, outboxId);
}

export async function finalizeAcceptedOutbox(supabase: SupabaseClient, outboxId: string): Promise<{
  sent: boolean; deliveryStatus: 'accepted_by_provider'; message: string;
}> {
  const settings = await getOutreachSettings(supabase);
  const { data, error } = await supabase.rpc('finalize_outreach_send', {
    p_outbox_id: outboxId,
    p_followup_at: nextAgencyBusinessMorning(new Date(), settings.timezone ?? DEFAULT_AGENCY_TIME_ZONE).toISOString(),
  });
  if (error) throw new Error(`Email accepted by provider, but bookkeeping failed; retry only to finish saving, not to resend: ${error.message}`);
  if (data !== true) throw new Error('Outreach finalization returned an invalid result; do not resend.');
  return { sent: true, deliveryStatus: 'accepted_by_provider', message: 'Accepted by email provider; recipient delivery is not confirmed.' };
}

/**
 * Reply sensor: when an inbound message arrives, stop any active sequence for
 * matching leads, cancel pending drafts, and raise an immediate call task.
 * Detects opt-out language and honors it permanently.
 */
export async function handleInboundReply(
  supabase: SupabaseClient,
  input: { clientId?: string | null; fromEmail?: string | null; fromPhone?: string | null; body?: string | null; logId?: string | null },
): Promise<{ sequenceLeadIds: string[] }> {
  const { data, error } = await supabase.rpc('process_outreach_reply', {
    p_client_id: input.clientId ?? null, p_email: input.fromEmail?.trim().toLowerCase() || null,
    p_phone: input.fromPhone ?? null, p_body: input.body ?? '', p_log_id: input.logId ?? null,
  });
  if (error) throw new Error(`Inbound reply processing failed: ${error.message}`);
  if (!data || !Array.isArray(data.sequenceLeadIds) || !data.sequenceLeadIds.every((id: unknown) => typeof id === 'string')) {
    throw new Error('Inbound reply processing returned an invalid result.');
  }
  return { sequenceLeadIds: data.sequenceLeadIds as string[] };
}
