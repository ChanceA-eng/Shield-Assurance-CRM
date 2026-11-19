import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_MARKETING_PROFILE } from '@crm/shared';
import { leadOutreachContext } from './lead-outreach-context';
import { draftSequenceStep } from './outreach-ai';
import { activeAgencyMember, agencyEnabled } from './agency-membership';
import { getOwnGmailConnection } from './gmail-provider';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';

interface CadenceTouch {
  id: string;
  cadence_id: string;
  touch_number: number;
  due_at: string;
}

interface CadenceRow {
  id: string;
  lead_id: string;
  agent_user_id: string;
  gmail_connection_id: string | null;
  status: string;
  started_at: string;
}

interface ProspectLead {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  source: string | null;
  status: string | null;
  form_payload: Record<string, unknown> | null;
}

export async function processDueProspectingEmailDrafts(
  supabase: SupabaseClient,
  limit = 30,
  cadenceId?: string,
): Promise<{ drafted: number; skipped: number }> {
  let query = supabase
    .from('prospecting_cadence_touches')
    .select('id,cadence_id,touch_number,due_at')
    .eq('channel', 'email')
    .eq('status', 'planned')
    .lte('due_at', new Date().toISOString())
    .order('due_at');
  if (cadenceId) query = query.eq('cadence_id', cadenceId);
  const { data: touches, error: touchError } = await query.limit(limit)
    .returns<CadenceTouch[]>();
  if (touchError) throw databaseError(touchError);

  let drafted = 0;
  let skipped = 0;
  for (const touch of touches ?? []) {
    const { data: cadence, error: cadenceError } = await supabase
      .from('prospecting_cadences')
      .select('id,lead_id,agent_user_id,gmail_connection_id,status,started_at')
      .eq('id', touch.cadence_id)
      .eq('status', 'active')
      .maybeSingle<CadenceRow>();
    if (cadenceError) throw databaseError(cadenceError);
    if (!cadence) { skipped += 1; continue; }
    const block = await supabase.rpc('prospecting_contact_block', { p_lead: cadence.lead_id, p_since: cadence.started_at });
    if (block.error) throw databaseError(block.error);
    if (block.data !== null) {
      if (!['pipeline_exit', 'do_not_contact', 'replied'].includes(block.data)) throw new Error('Prospecting contact checks returned an invalid result.');
      const stopped = await supabase.rpc('stop_prospecting_cadence', {
        p_cadence: cadence.id, p_status: block.data, p_reason: `Prospecting stopped: ${block.data.replaceAll('_', ' ')}.`,
      });
      if (stopped.error) throw databaseError(stopped.error);
      skipped += 1;
      continue;
    }

    await activeAgencyMember(supabase, cadence.agent_user_id);
    if (agencyEnabled()) {
      const mailbox = await getOwnGmailConnection(supabase, cadence.agent_user_id);
      if (!mailbox || mailbox.status !== 'connected' || mailbox.id !== cadence.gmail_connection_id) {
        throw new WorkspaceError('The prospecting plan owner must reconnect their approved Gmail mailbox before preparing drafts.', 409);
      }
    }

    const { data: record, error: leadError } = await supabase.from('leads')
      .select('id,full_name,email,phone,address,line_of_business,source,status,form_payload')
      .eq('id', cadence.lead_id)
      .maybeSingle<ProspectLead>();
    if (leadError) throw databaseError(leadError);
    if (!record || typeof record.email !== 'string' || !record.email.trim()) {
      const stopped = await supabase.rpc('stop_prospecting_cadence', {
        p_cadence: cadence.id, p_status: 'cancelled', p_reason: 'A valid email address is no longer available.',
      });
      if (stopped.error) throw databaseError(stopped.error);
      skipped += 1;
      continue;
    }

    const target = await resolveOutboundEmailRecipient(supabase, { leadId: cadence.lead_id, to: record.email });
    if (!target.ok) {
      if (target.status >= 500) throw new WorkspaceError(target.message, target.status);
      const status = ['do_not_contact', 'opted_out', 'contact_declined'].includes(target.code)
        ? 'do_not_contact' : 'cancelled';
      const stopped = await supabase.rpc('stop_prospecting_cadence', {
        p_cadence: cadence.id, p_status: status, p_reason: target.message,
      });
      if (stopped.error) throw databaseError(stopped.error);
      skipped += 1;
      continue;
    }

    const lead = { ...record, ...await leadOutreachContext(supabase, cadence.lead_id, cadence.agent_user_id) };
    const profile = lead.marketing_profile ?? EMPTY_MARKETING_PROFILE;
    const draftLead = touch.touch_number === 2
      ? { ...lead, marketing_profile: { ...profile, template: 'cold_prospecting' as const } }
      : lead;
    const priorTouches = await supabase.from('prospecting_cadence_touches')
      .select('outbox_id,status')
      .eq('cadence_id', cadence.id)
      .eq('channel', 'email')
      .lt('touch_number', touch.touch_number);
    if (priorTouches.error) throw databaseError(priorTouches.error);
    if (priorTouches.data?.some((prior) => ['planned', 'draft_ready'].includes(prior.status))) {
      skipped += 1;
      continue;
    }
    const priorOutboxIds = (priorTouches.data ?? []).map((row) => row.outbox_id).filter((id): id is string => typeof id === 'string');
    let priorEmails: Array<{ subject: string; body: string }> = [];
    if (priorOutboxIds.length) {
      const sentPrior = await supabase.from('outreach_outbox').select('subject,body')
        .in('id', priorOutboxIds).eq('status', 'sent').order('sent_at');
      if (sentPrior.error) throw databaseError(sentPrior.error);
      priorEmails = (sentPrior.data ?? []).filter((item) => item.subject && item.body);
    }

    const emailOrdinal = [2, 4, 6, 7].indexOf(touch.touch_number) + 1;
    const draft = await draftSequenceStep(
      draftLead,
      emailOrdinal,
      4,
      priorEmails,
    );
    if (!draft) throw new WorkspaceError('AI drafting is unavailable. No prospecting email draft was saved.', 503);

    const created = await supabase.rpc('create_prospecting_email_draft', {
      p_touch: touch.id, p_to: target.recipient.to,
      p_subject: draft.subject, p_body: draft.body, p_signals: draft.cited_signals,
    });
    if (created.error) throw databaseError(created.error);
    if (typeof created.data !== 'boolean') throw new Error('Prospecting draft creation returned an invalid result.');
    if (created.data) drafted += 1;
    else skipped += 1;
  }
  return { drafted, skipped };
}
