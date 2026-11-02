/**
 * Outreach sequence engine. A lead enrolled in a sequence receives a short
 * series of AI-drafted, fact-grounded emails (default 3, ~5 days apart).
 * Drafts land in an approval outbox; a reply or opt-out stops the sequence
 * immediately and raises a call task.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_OUTREACH_SENDER, type OutreachSender, type WorkspaceAsset, type WorkspaceNote } from '@crm/shared';
import { parseOutreachSender } from './marketing-profile';
import { leadOutreachContext } from './lead-outreach-context';
import { draftSequenceStep } from './outreach-ai';
import { sendOutboundEmail } from './email-adapter';
import { nextArizonaBusinessMorning, startOfArizonaDay } from './arizona-time';
import { resolveOutboundEmailRecipient } from './message-delivery';

const ARIZONA_UTC_OFFSET_HOURS = 7;

export interface OutreachSettings {
  approval_mode: boolean;
  daily_send_cap: number;
  send_window_start: number;
  send_window_end: number;
  opt_out_footer: string;
  sender_profile: OutreachSender;
}

export interface EnrollmentRow {
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
  return {
    approval_mode: data?.approval_mode ?? true,
    daily_send_cap: data?.daily_send_cap ?? 20,
    send_window_start: data?.send_window_start ?? 8,
    send_window_end: data?.send_window_end ?? 17,
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

export async function sentTodayCount(supabase: SupabaseClient): Promise<number> {
  const dayStart = startOfArizonaDay(new Date()).toISOString();
  const { count, error } = await supabase
    .from('outreach_outbox')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'accepted_by_provider', 'sending', 'acceptance_unknown'])
    .gte('sent_at', dayStart);
  if (error) throw new Error(`Unable to check today's outreach count: ${error.message}`);
  return count ?? 0;
}

function inSendWindow(settings: OutreachSettings, now: Date): boolean {
  const azHour = (now.getUTCHours() - ARIZONA_UTC_OFFSET_HOURS + 24) % 24;
  return azHour >= settings.send_window_start && azHour < settings.send_window_end;
}

async function fetchLead(supabase: SupabaseClient, leadId: string): Promise<LeadRow | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('id,full_name,email,phone,address,line_of_business,source,status,form_payload')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();
  if (error) throw new Error(`Unable to load the lead for outreach: ${error.message}`);
  return data ? { ...data, ...await leadOutreachContext(supabase, leadId) } : null;
}

/**
 * Starts a sequence for a lead. Generates the first draft right away so the
 * producer immediately has something to review in the outbox.
 */
export async function enrollLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ enrollment?: EnrollmentRow; drafted: boolean; message?: string }> {
  const lead = await fetchLead(supabase, leadId);
  if (!lead) return { drafted: false, message: 'Lead not found.' };

  const email = (lead.email ?? '').trim().toLowerCase();
  if (!email) return { drafted: false, message: 'This lead has no email address — add one before enrolling.' };
  if (await isOptedOut(supabase, email)) {
    return { drafted: false, message: 'This address has opted out of outreach emails.' };
  }

  const existing = await supabase
    .from('sequence_enrollments')
    .select('id,status')
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused'])
    .maybeSingle();
  if (existing.error) throw new Error(`Unable to check enrollment: ${existing.error.message}`);
  if (existing.data) {
    return { drafted: false, message: `Already enrolled (${existing.data.status}).` };
  }

  const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert([{ lead_id: leadId, status: 'active', next_send_at: new Date().toISOString() }])
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

  const draft = await draftSequenceStep(lead, step, enrollment.total_steps, prior.data ?? []);
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

/**
 * Processes all enrollments whose next send is due: drafts the next step into
 * the outbox, and auto-sends when approval mode is off (within the send window
 * and under the daily cap).
 */
export async function processDueEnrollments(
  supabase: SupabaseClient,
): Promise<{ drafted: number; autoSent: number; skipped: number }> {
  const settings = await getOutreachSettings(supabase);
  const now = new Date();

  const { data: accepted, error: recoveryError } = await supabase.from('outreach_outbox')
    .select('id').eq('status', 'accepted_by_provider').limit(50);
  if (recoveryError) throw new Error(`Unable to load accepted outreach for recovery: ${recoveryError.message}`);
  for (const item of accepted ?? []) await finalizeAcceptedOutbox(supabase, item.id);

  const { data: due, error: dueError } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', now.toISOString())
    .limit(50);
  if (dueError) throw new Error(`Unable to load due enrollments: ${dueError.message}`);

  let drafted = 0;
  let autoSent = 0;
  let skipped = 0;

  for (const enrollment of (due ?? []) as EnrollmentRow[]) {
    const lead = await fetchLead(supabase, enrollment.lead_id);
    if (!lead || !lead.email) {
      skipped += 1;
      continue;
    }
    if (await isOptedOut(supabase, lead.email)) {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'opted_out', ended_at: now.toISOString(), ended_reason: 'Address opted out.' })
        .eq('id', enrollment.id).eq('status', 'active');
      if (error) throw new Error(`Unable to stop opted-out enrollment: ${error.message}`);
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

    const created = await generateStepDraft(supabase, enrollment, lead);
    if (created) drafted += 1;

    if (!settings.approval_mode && inSendWindow(settings, now)) {
      const sentToday = await sentTodayCount(supabase);
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
        const result = await sendOutboxItem(supabase, item.id);
        if (result.sent) autoSent += 1;
      }
    }
  }

  return { drafted, autoSent, skipped };
}

/**
 * Claim before contacting the provider. A crashed/ambiguous attempt is never
 * automatically resent. Known acceptance can retry transactional bookkeeping.
 * Legacy "sent" means provider acceptance, not proof of recipient delivery.
 */
export async function sendOutboxItem(
  supabase: SupabaseClient,
  outboxId: string,
  overrides?: { subject?: string; body?: string },
): Promise<{ sent: boolean; message?: string; deliveryStatus?: 'accepted_by_provider' }> {
  const { data: item, error: loadError } = await supabase.from('outreach_outbox').select('*').eq('id', outboxId).maybeSingle<OutboxRow>();
  if (loadError) throw new Error(`Unable to load outbox item: ${loadError.message}`);
  if (!item) return { sent: false, message: 'Outbox item not found.' };
  if (item.status === 'sent') return { sent: false, deliveryStatus: 'accepted_by_provider', message: 'Already accepted by the email provider; delivery is not confirmed.' };
  if (item.status === 'accepted_by_provider') return finalizeAcceptedOutbox(supabase, item.id);
  if (item.status !== 'pending_approval') {
    return { sent: false, message: 'This item cannot be sent. A prior or uncertain attempt must be reconciled with the provider before any retry.' };
  }

  const settings = await getOutreachSettings(supabase);
  const subject = overrides?.subject?.trim() || item.subject;
  const bodyCore = overrides?.body?.trim() || item.body;
  const body = `${bodyCore}\n\n--\n${settings.opt_out_footer}`;
  const target = await resolveOutboundEmailRecipient(supabase, { leadId: item.lead_id, to: item.to_email });
  if (!target.ok) {
    if (target.status >= 500) throw new Error(target.message);
    return { sent: false, message: target.message };
  }
  const { data: claimed, error: claimError } = await supabase.rpc('claim_outreach_send', {
    p_outbox_id: outboxId, p_subject: subject, p_body: body,
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

  let provider: string;
  try {
    provider = await sendOutboundEmail({ to: rechecked.recipient.to, subject, body });
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
    throw new Error(`Email accepted by provider, but acceptance could not be saved; do not resend: ${acceptanceError?.message ?? 'send state changed'}`);
  }
  return finalizeAcceptedOutbox(supabase, outboxId);
}

export async function finalizeAcceptedOutbox(supabase: SupabaseClient, outboxId: string): Promise<{
  sent: boolean; deliveryStatus: 'accepted_by_provider'; message: string;
}> {
  const { data, error } = await supabase.rpc('finalize_outreach_send', {
    p_outbox_id: outboxId, p_followup_at: nextArizonaBusinessMorning(new Date()).toISOString(),
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
