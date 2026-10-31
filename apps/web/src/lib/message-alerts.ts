import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeNotification } from './automation';
import { isActiveLeadStatus } from './lead-pipeline';

export type InboundChannel = 'email' | 'sms';

export interface InboundSender {
  clientId: string | null;
  leadId: string | null;
  name: string | null;
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

/** Resolves the account and/or lead a message came from. Never throws. */
export async function resolveInboundSender(
  supabase: SupabaseClient,
  input: { email?: string | null; phone?: string | null },
): Promise<InboundSender> {
  const email = (input.email ?? '').trim().toLowerCase();
  const digits = phoneDigits(input.phone);
  let client: ContactRow | null = null;
  let lead: ContactRow | null = null;

  try {
    if (email) {
      const [clientRes, leadRes] = await Promise.all([
        supabase.from('clients').select('id,full_name').ilike('email', email).order('created_at', { ascending: true }).limit(1),
        supabase.from('leads').select('id,full_name,account_id,status').ilike('email', email).order('created_at', { ascending: false }).limit(5),
      ]);
      client = ((clientRes.data ?? []) as ContactRow[])[0] ?? null;
      lead = pickLead((leadRes.data ?? []) as Array<ContactRow & { status?: string | null }>);
    } else if (digits.length >= 7) {
      const tail = digits.slice(-4);
      const [clientRes, leadRes] = await Promise.all([
        supabase.from('clients').select('id,full_name,phone').ilike('phone', `%${tail}`).limit(50),
        supabase.from('leads').select('id,full_name,phone,account_id,status').ilike('phone', `%${tail}`).order('created_at', { ascending: false }).limit(50),
      ]);
      client = ((clientRes.data ?? []) as ContactRow[]).find((row) => phoneDigits(row.phone) === digits) ?? null;
      lead = pickLead(((leadRes.data ?? []) as Array<ContactRow & { status?: string | null }>).filter((row) => phoneDigits(row.phone) === digits));
    }
  } catch {
    return { clientId: null, leadId: null, name: null };
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
    channel: InboundChannel;
    fromAddress: string;
    subject: string | null;
    body: string | null;
    skipTask?: boolean;
  },
): Promise<{ taskCreated: boolean }> {
  const { sender, channel } = input;
  const name = sender.name || input.fromAddress || 'Unknown sender';
  const href = senderHref(sender);

  await writeNotification({
    client_id: sender.clientId,
    type: 'message',
    message: inboundNotificationMessage(name, channel, input.subject, input.body),
    href,
  });

  const relatedType = sender.clientId ? 'client' : sender.leadId ? 'lead' : null;
  const relatedId = sender.clientId ?? sender.leadId;
  if (input.skipTask || !relatedType || !relatedId) return { taskCreated: false };

  try {
    const existing = await supabase
      .from('tasks')
      .select('id')
      .eq('related_type', relatedType)
      .eq('related_id', relatedId)
      .eq('status', 'open')
      .ilike('subject', 'Reply%')
      .limit(1);
    if ((existing.data ?? []).length > 0) return { taskCreated: false };

    const preview = (input.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
    const { error } = await supabase.from('tasks').insert([
      {
        subject: replyTaskSubject(name, channel),
        description: [
          channel === 'sms' ? `Text from ${input.fromAddress}` : `Email from ${input.fromAddress}`,
          input.subject && channel === 'email' ? `Subject: ${input.subject}` : null,
          preview ? `Message: ${preview}` : null,
        ].filter(Boolean).join('\n'),
        due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        status: 'open',
        priority: 'high',
        kind: 'task',
        related_type: relatedType,
        related_id: relatedId,
      },
    ]);
    return { taskCreated: !error };
  } catch {
    return { taskCreated: false };
  }
}
