/**
 * Outreach sequence engine. A lead enrolled in a sequence receives a short
 * series of AI-drafted, fact-grounded emails (default 3, ~5 days apart).
 * Drafts land in an approval outbox; a reply or opt-out stops the sequence
 * immediately and raises a call task.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { leadOutreachContext } from './lead-outreach-context';
import { draftSequenceStep } from './outreach-ai';
import { sendOutboundEmail } from './email-adapter';
import { writeNotification } from './automation';
import { nextArizonaBusinessMorning, startOfArizonaDay } from './arizona-time';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ARIZONA_UTC_OFFSET_HOURS = 7;

export interface OutreachSettings {
  approval_mode: boolean;
  daily_send_cap: number;
  send_window_start: number;
  send_window_end: number;
  opt_out_footer: string;
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
  const { data } = await supabase.from('outreach_settings').select('*').eq('id', 1).maybeSingle();
  return {
    approval_mode: data?.approval_mode ?? true,
    daily_send_cap: data?.daily_send_cap ?? 20,
    send_window_start: data?.send_window_start ?? 8,
    send_window_end: data?.send_window_end ?? 17,
    opt_out_footer:
      data?.opt_out_footer ??
      'If you\u2019d prefer not to receive these emails, reply "unsubscribe" and we\u2019ll remove you right away. Shield Assurance, Tucson, AZ.',
  };
}

export async function isOptedOut(supabase: SupabaseClient, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const { data } = await supabase.from('outreach_opt_outs').select('email').eq('email', normalized).maybeSingle();
  return Boolean(data);
}

export async function sentTodayCount(supabase: SupabaseClient): Promise<number> {
  const dayStart = startOfArizonaDay(new Date()).toISOString();
  const { count } = await supabase
    .from('outreach_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', dayStart);
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
  if (existing.data) {
    return { drafted: false, message: `Already enrolled (${existing.data.status}).` };
  }

  const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .insert([{ lead_id: leadId, status: 'active', next_send_at: new Date().toISOString() }])
    .select('*')
    .single<EnrollmentRow>();
  if (error || !enrollment) return { drafted: false, message: error?.message ?? 'Failed to enroll.' };

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
    .eq('step_number', step)
    .in('status', ['pending_approval', 'sent']);
  if ((pending.count ?? 0) > 0) return false;

  const prior = await supabase
    .from('outreach_outbox')
    .select('subject,body')
    .eq('enrollment_id', enrollment.id)
    .eq('status', 'sent')
    .order('sent_at', { ascending: true });

  const draft = await draftSequenceStep(lead, step, enrollment.total_steps, prior.data ?? []);
  if (!draft) return false;

  const { error } = await supabase.from('outreach_outbox').insert([
    {
      enrollment_id: enrollment.id,
      lead_id: lead.id,
      step_number: step,
      to_email: (lead.email ?? '').trim().toLowerCase(),
      subject: draft.subject,
      body: draft.body,
      cited_signals: draft.cited_signals,
      status: 'pending_approval',
    },
  ]);
  return !error;
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

  const { data: due } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', now.toISOString())
    .limit(50);

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
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'opted_out', ended_at: now.toISOString(), ended_reason: 'Address opted out.' })
        .eq('id', enrollment.id);
      skipped += 1;
      continue;
    }

    // Stop sequences for leads that moved past prospecting.
    if (lead.status === 'won' || lead.status === 'lost') {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'cancelled', ended_at: now.toISOString(), ended_reason: `Lead marked ${lead.status}.` })
        .eq('id', enrollment.id);
      skipped += 1;
      continue;
    }

    const created = await generateStepDraft(supabase, enrollment, lead);
    if (created) drafted += 1;

    if (!settings.approval_mode && inSendWindow(settings, now)) {
      const sentToday = await sentTodayCount(supabase);
      if (sentToday >= settings.daily_send_cap) continue;
      const { data: item } = await supabase
        .from('outreach_outbox')
        .select('*')
        .eq('enrollment_id', enrollment.id)
        .eq('step_number', enrollment.current_step + 1)
        .eq('status', 'pending_approval')
        .maybeSingle<OutboxRow>();
      if (item) {
        const result = await sendOutboxItem(supabase, item.id);
        if (result.sent) autoSent += 1;
      }
    }
  }

  return { drafted, autoSent, skipped };
}

/** Finds (or creates) the client record a lead's conversation is logged against. */
async function ensureClientForLead(supabase: SupabaseClient, lead: LeadRow): Promise<string | null> {
  const linked = await supabase.rpc('link_lead_account', { p_lead_id: lead.id, p_client_id: null, p_create: true });
  if (linked.error) throw new Error(linked.error.message);
  if (typeof linked.data !== 'string') throw new Error('Account linking returned an invalid record id.');
  return linked.data;
}

/**
 * Sends an outbox item (optionally with producer edits), logs it on the lead's
 * conversation, and advances the enrollment. The final step schedules a call task.
 */
export async function sendOutboxItem(
  supabase: SupabaseClient,
  outboxId: string,
  overrides?: { subject?: string; body?: string },
): Promise<{ sent: boolean; message?: string }> {
  const { data: item } = await supabase.from('outreach_outbox').select('*').eq('id', outboxId).maybeSingle<OutboxRow>();
  if (!item) return { sent: false, message: 'Outbox item not found.' };
  if (item.status === 'sent') return { sent: false, message: 'Already sent.' };

  const lead = await fetchLead(supabase, item.lead_id);
  if (!lead) return { sent: false, message: 'Lead not found.' };

  const settings = await getOutreachSettings(supabase);
  const subject = overrides?.subject?.trim() || item.subject;
  const bodyCore = overrides?.body?.trim() || item.body;
  const body = `${bodyCore}\n\n--\n${settings.opt_out_footer}`;
  const now = new Date();

  if (await isOptedOut(supabase, item.to_email)) {
    await supabase.from('outreach_outbox').update({ status: 'rejected', error: 'Recipient opted out.' }).eq('id', outboxId);
    return { sent: false, message: 'Recipient has opted out.' };
  }
  const clientId = await ensureClientForLead(supabase, lead);

  try {
    await sendOutboundEmail({ to: item.to_email, subject, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery failed.';
    await supabase.from('outreach_outbox').update({ status: 'failed', error: message }).eq('id', outboxId);
    return { sent: false, message };
  }

  await supabase
    .from('outreach_outbox')
    .update({ status: 'sent', subject, body, sent_at: now.toISOString(), error: null })
    .eq('id', outboxId);

  // Log on the conversation so the thread shows the touch.
  if (clientId) {
    await supabase.from('communication_log').insert([
      {
        client_id: clientId,
        channel: 'email',
        direction: 'outbound',
        subject,
        body,
        automation_type: 'outreach_sequence',
        sent_at: now.toISOString(),
      },
    ]);
  }

  // Advance the enrollment.
  if (item.enrollment_id) {
    const { data: enrollment } = await supabase
      .from('sequence_enrollments')
      .select('*')
      .eq('id', item.enrollment_id)
      .maybeSingle<EnrollmentRow>();
    if (enrollment) {
      if (item.step_number >= enrollment.total_steps) {
        await supabase
          .from('sequence_enrollments')
          .update({
            current_step: item.step_number,
            last_sent_at: now.toISOString(),
            next_send_at: null,
            status: 'completed',
            ended_at: now.toISOString(),
            ended_reason: 'All emails sent.',
          })
          .eq('id', enrollment.id);

        // Sequence exhausted without a reply — time for a call.
        await supabase.from('tasks').insert([
          {
            subject: `Call ${lead.full_name} — email sequence finished`,
            description: `All ${enrollment.total_steps} sequence emails went out with no reply. A direct call is the next touch.`,
            due_date: nextArizonaBusinessMorning(now).toISOString(),
            status: 'open',
            priority: 'high',
            related_type: 'lead',
            related_id: lead.id,
          },
        ]);
      } else {
        const nextSend = new Date(
          startOfArizonaDay(new Date(now.getTime() + enrollment.step_gap_days * DAY_MS)).getTime() + 16 * HOUR_MS, // 9 AM AZ
        );
        await supabase
          .from('sequence_enrollments')
          .update({ current_step: item.step_number, last_sent_at: now.toISOString(), next_send_at: nextSend.toISOString() })
          .eq('id', enrollment.id);
      }
    }
  }

  return { sent: true };
}

const OPT_OUT_PATTERN = /\bunsubscribe\b|\bopt[\s-]?out\b|stop (sending|emailing)|remove me/i;

/**
 * Reply sensor: when an inbound message arrives, stop any active sequence for
 * matching leads, cancel pending drafts, and raise an immediate call task.
 * Detects opt-out language and honors it permanently.
 */
export async function handleInboundReply(
  supabase: SupabaseClient,
  input: { clientId?: string | null; fromEmail?: string | null; body?: string | null },
): Promise<void> {
  try {
    let email = (input.fromEmail ?? '').trim().toLowerCase();
    if (!email && input.clientId) {
      const { data: client } = await supabase.from('clients').select('email').eq('id', input.clientId).maybeSingle();
      email = ((client?.email as string | undefined) ?? '').trim().toLowerCase();
    }
    if (!email) return;

    const optedOut = OPT_OUT_PATTERN.test(input.body ?? '');
    if (optedOut) {
      await supabase.from('outreach_opt_outs').upsert([{ email, reason: 'Requested in reply.' }], { onConflict: 'email' });
    }

    const { data: leads } = await supabase.from('leads').select('id,full_name').ilike('email', email).limit(10);
    if (!leads || leads.length === 0) return;

    const leadIds = leads.map((lead) => lead.id as string);
    const { data: enrollments } = await supabase
      .from('sequence_enrollments')
      .select('id,lead_id')
      .in('lead_id', leadIds)
      .in('status', ['active', 'paused']);
    if (!enrollments || enrollments.length === 0) return;

    const now = new Date();
    const enrollmentIds = enrollments.map((enrollment) => enrollment.id as string);

    await supabase
      .from('sequence_enrollments')
      .update({
        status: optedOut ? 'opted_out' : 'replied',
        ended_at: now.toISOString(),
        ended_reason: optedOut ? 'Recipient asked to stop.' : 'Prospect replied.',
        next_send_at: null,
      })
      .in('id', enrollmentIds);

    await supabase
      .from('outreach_outbox')
      .update({ status: 'rejected', error: optedOut ? 'Recipient opted out.' : 'Prospect replied — sequence stopped.' })
      .in('enrollment_id', enrollmentIds)
      .eq('status', 'pending_approval');

    for (const enrollment of enrollments) {
      const lead = leads.find((candidate) => candidate.id === enrollment.lead_id);
      const name = (lead?.full_name as string | undefined) ?? 'Prospect';
      if (!optedOut) {
        await supabase.from('tasks').insert([
          {
            subject: `Reply from ${name} — call while it's warm`,
            description: 'They replied to a sequence email. The sequence is stopped; follow up personally today.',
            due_date: new Date(now.getTime() + 2 * HOUR_MS).toISOString(),
            status: 'open',
            priority: 'high',
            related_type: 'lead',
            related_id: enrollment.lead_id as string,
          },
        ]);
      }
      await writeNotification({
        type: 'outreach',
        message: optedOut ? `${name} asked to stop emails — opted out and sequence ended.` : `${name} replied — sequence stopped, call task created.`,
        href: `/leads?lead=${enrollment.lead_id}`,
      });
    }
  } catch {
    // Reply handling is best-effort; logging the message must never fail because of it.
  }
}
