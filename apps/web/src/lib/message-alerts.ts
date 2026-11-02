import { createHash, createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isActiveLeadStatus } from './lead-pipeline';

export type InboundChannel = 'email' | 'sms';

export interface InboundSender {
  clientId: string | null;
  leadId: string | null;
  name: string | null;
}

/**
 * Prefer the provider/RFC message identity. Legacy payloads without an identity
 * use a stable content fingerprint; receipt time must never enter that key.
 */
export function inboundEventKey(channel: InboundChannel, providerId: string | null | undefined, payload: unknown): string {
  const identity = providerId?.trim();
  return `${channel}:${identity ? 'id' : 'fingerprint'}:${createHash('sha256')
    .update(identity || JSON.stringify(payload)).digest('hex')}`;
}

export interface InboundMessage {
  id: string;
  client_id: string | null;
  channel: InboundChannel;
  direction: string;
  subject: string | null;
  sent_at: string;
}

/** The RPC commits the log and account activity together, returning the original log on retries. */
export async function ingestInboundMessage(
  supabase: SupabaseClient,
  input: {
    eventKey: string; sender: InboundSender; channel: InboundChannel;
    from: string; to: string | null; subject: string; body: string; sentAt: string;
    providerId?: string | null;
  },
): Promise<InboundMessage> {
  const { data, error } = await supabase.rpc('ingest_inbound_message', {
    p_event_key: input.eventKey, p_client_id: input.sender.clientId, p_lead_id: input.sender.leadId,
    p_channel: input.channel, p_from: input.from, p_to: input.to, p_subject: input.subject,
    p_body: input.body, p_sent_at: input.sentAt, p_provider_id: input.providerId ?? null,
  });
  if (error) throw new Error(`Inbound message could not be saved: ${error.message}`);
  if (!data || typeof data.id !== 'string') throw new Error('Inbound ingestion returned an invalid log.');
  return data as InboundMessage;
}

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function replyTaskSubject(name: string, channel: InboundChannel): string {
  return channel === 'sms' ? `Reply to ${name}'s text message` : `Reply to ${name}'s email`;
}

export function inboundNotificationMessage(name: string, channel: InboundChannel, subject: string | null, body: string | null): string {
  const label = channel === 'sms' ? 'New text from' : 'New email from';
  const detail = (channel === 'email' ? subject : null) || (body ?? '').replace(/\s+/g, ' ').trim();
  const snippet = detail.length > 90 ? `${detail.slice(0, 87)}...` : detail;
  return snippet ? `${label} ${name}: ${snippet}` : `${label} ${name}`;
}

export function senderHref(sender: InboundSender): string {
  if (sender.leadId && !sender.clientId) return `/leads?lead=${sender.leadId}`;
  if (sender.clientId) return `/clients/${sender.clientId}?tab=communication`;
  return '/communication';
}

interface ContactRow {
  id: string;
  full_name: string | null;
  email?: string | null;
  phone?: string | null;
  account_id?: string | null;
}

function pickLead(rows: Array<ContactRow & { status?: string | null }>): ContactRow | null {
  return rows.find((row) => isActiveLeadStatus(row.status ?? '')) ?? rows[0] ?? null;
}

/** Lookup failures must stop processing rather than misclassifying a known sender as unmatched. */
export async function resolveInboundSender(
  supabase: SupabaseClient,
  input: { email?: string | null; phone?: string | null },
): Promise<InboundSender> {
  const email = (input.email ?? '').trim().toLowerCase();
  const digits = phoneDigits(input.phone);
  let client: ContactRow | null = null;
  let lead: ContactRow | null = null;

    if (email) {
      const [clientRes, leadRes] = await Promise.all([
        supabase.from('clients').select('id,full_name').ilike('email', email).order('created_at', { ascending: true }).limit(1),
        supabase.from('leads').select('id,full_name,account_id,status').ilike('email', email).order('created_at', { ascending: false }).limit(5),
      ]);
      if (clientRes.error) throw new Error(`Account sender lookup failed: ${clientRes.error.message}`);
      if (leadRes.error) throw new Error(`Lead sender lookup failed: ${leadRes.error.message}`);
      client = ((clientRes.data ?? []) as ContactRow[])[0] ?? null;
      lead = pickLead((leadRes.data ?? []) as Array<ContactRow & { status?: string | null }>);
    } else if (digits.length >= 7) {
      const tail = digits.slice(-4);
      const [clientRes, leadRes] = await Promise.all([
        supabase.from('clients').select('id,full_name,phone').ilike('phone', `%${tail}`).limit(50),
        supabase.from('leads').select('id,full_name,phone,account_id,status').ilike('phone', `%${tail}`).order('created_at', { ascending: false }).limit(50),
      ]);
      if (clientRes.error) throw new Error(`Account sender lookup failed: ${clientRes.error.message}`);
      if (leadRes.error) throw new Error(`Lead sender lookup failed: ${leadRes.error.message}`);
      client = ((clientRes.data ?? []) as ContactRow[]).find((row) => phoneDigits(row.phone) === digits) ?? null;
      lead = pickLead(((leadRes.data ?? []) as Array<ContactRow & { status?: string | null }>).filter((row) => phoneDigits(row.phone) === digits));
    }

  const clientId = client?.id ?? lead?.account_id ?? null;
  return {
    clientId,
    leadId: lead?.id ?? null,
    name: client?.full_name?.trim() || lead?.full_name?.trim() || null,
  };
}

/**
 * Every inbound client/lead message raises one notification and keeps exactly
 * one open "Reply to ..." task on the record (no duplicates while it's open).
 */
export async function alertInboundMessage(
  supabase: SupabaseClient,
  input: {
    sender: InboundSender;
    logId: string;
    channel: InboundChannel;
    fromAddress: string;
    subject: string | null;
    body: string | null;
    skipTask?: boolean;
  },
): Promise<{ taskCreated: boolean }> {
  const { data, error } = await supabase.rpc('alert_inbound_message', { p_log_id: input.logId, p_skip_task: Boolean(input.skipTask) });
  if (error) throw new Error(`Message saved, but its task/notification could not be created: ${error.message}`);
  if (!data || typeof data.taskCreated !== 'boolean') throw new Error('The inbound alert returned an invalid result.');
  return { taskCreated: data.taskCreated };
}
