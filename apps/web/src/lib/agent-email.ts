import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOwnGmailConnection, gmailRequest } from './gmail-provider';
import { getAgentEmailSender } from './agent-email-sender';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';
import type { OutboundEmail } from './email-adapter';
import { ensureWebsiteLink, renderEmailHtml, emailPlainText, parseEmailDesign, hasUnresolvedSalesFields, type SalesTemplateSnapshot } from '@crm/shared';

function safeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new WorkspaceError('Email headers cannot contain line breaks.', 400);
  return value;
}
function mimeBase64(value: string): string {
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new WorkspaceError('Email attachment data must be valid base64.', 400);
  return value.match(/.{1,76}/g)?.join('\r\n') ?? '';
}
export function agentMime(input: OutboundEmail, from: string, name: string, messageId: string, reply?: { messageId: string; references: string }): string {
  const subject = `=?UTF-8?B?${Buffer.from(safeHeader(input.subject)).toString('base64')}?=`;
  const encodedName = `=?UTF-8?B?${Buffer.from(safeHeader(name)).toString('base64')}?=`;
  const headers = [`From: ${encodedName} <${safeHeader(from)}>`, `To: ${safeHeader(input.to)}`, `Subject: ${subject}`, `Message-ID: ${safeHeader(messageId)}`, 'MIME-Version: 1.0'];
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!['List-Unsubscribe', 'List-Unsubscribe-Post'].includes(name)) throw new WorkspaceError('Unsupported marketing email header.', 400);
    headers.push(`${name}: ${safeHeader(value)}`);
  }
  if (reply) headers.push(`In-Reply-To: ${safeHeader(reply.messageId)}`, `References: ${safeHeader(`${reply.references} ${reply.messageId}`.trim())}`);
  const boundary = `crm_${createHash('sha256').update(messageId).digest('hex')}`;
  const alternative = `${boundary}_alternative`;
  const text = emailPlainText(input.body, input.emailDesign, input);
  const html = renderEmailHtml(input.body, input.emailDesign, input);
  if ([input.subject, text, html].some(hasUnresolvedSalesFields)) {
    throw new WorkspaceError('Complete the template details in the message, layout and signature before sending.', 400);
  }
  const content = [
    `--${alternative}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', mimeBase64(Buffer.from(text).toString('base64')),
    `--${alternative}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', mimeBase64(Buffer.from(html).toString('base64')),
    `--${alternative}--`,
  ];
  if (!input.attachments?.length) return [...headers, `Content-Type: multipart/alternative; boundary="${alternative}"`, '', ...content].join('\r\n');
  const parts = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, '', ...content];
  for (const attachment of input.attachments) {
    const filename = safeHeader(attachment.filename).replace(/["\\]/g, '_');
    const type = safeHeader(attachment.type ?? 'application/octet-stream');
    parts.push(`--${boundary}`, `Content-Type: ${type}`, `Content-Disposition: attachment; filename="${filename}"`, 'Content-Transfer-Encoding: base64', '', mimeBase64(attachment.content));
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

export async function sendAgentEmail(
  db: SupabaseClient, userId: string, input: OutboundEmail,
  options: { attemptId: string; clientId: string | null; leadId: string | null; replyId?: string; salesTemplate?: SalesTemplateSnapshot },
): Promise<{ id: string; provider: 'gmail'; status: string }> {
  if (!isUuid(options.attemptId)) throw new WorkspaceError('A stable send request ID is required. Refresh the composer before sending.', 400);
  const connection = await getOwnGmailConnection(db, userId);
  if (!connection || connection.status !== 'connected') throw new WorkspaceError('Connect your own Gmail mailbox before sending.', 409);
  const sender = await getAgentEmailSender(db, userId);
  const design = parseEmailDesign(options.salesTemplate?.email_design ?? input.emailDesign);
  const legacyBody = input.body.endsWith(sender.signature) || input.body.includes(`-- \n${sender.signature}`) ? input.body : `${input.body}\n\n-- \n${sender.signature}`;
  const body = ensureWebsiteLink(legacyBody);
  const signed = { ...input, body, ...(!input.signatureDocument ? {
    signatureDocument: sender.signatureDocument, signatureRows: sender.signatureRows,
  } : {}), ...(design ? { emailDesign: design } : {}) };
  const hash = createHash('sha256').update(JSON.stringify({ input: signed, options, connection: connection.id, sender })).digest('hex');
  const rfc = `<crm-${options.attemptId}@${connection.email.split('@')[1]}>`;
  const old = await db.from('agent_email_attempts').select('id,user_id,status,content_hash,communication_id').eq('id', options.attemptId).maybeSingle();
  if (old.error) throw databaseError(old.error);
  if (old.data) {
    const legacyHash = createHash('sha256').update(JSON.stringify({ input: { ...input, body: legacyBody }, options, connection: connection.id, sender })).digest('hex');
    if (old.data.user_id !== userId || (old.data.content_hash !== hash && old.data.content_hash !== legacyHash)) throw new WorkspaceError('This send request was already used with a different sender or content. Review before composing a new message.', 409);
    if (old.data.status === 'recorded') return { id: old.data.communication_id, provider: 'gmail', status: 'accepted_by_provider' };
    if (old.data.status === 'accepted_by_provider') {
      const saved = await db.rpc('finalize_agent_email', { p_attempt_id: options.attemptId });
      if (saved.error) throw databaseError(saved.error);
      return { id: saved.data as string, provider: 'gmail', status: 'accepted_by_provider' };
    }
    throw new WorkspaceError(connection.sync_enabled
      ? 'This send is in progress or acceptance is uncertain. Do not resend; Gmail synchronization will reconcile Sent history.'
      : 'This send is in progress or acceptance is uncertain. Check Gmail Sent and contact your administrator; send-only access cannot reconcile mailbox history. Do not resend.', 409);
  }
  const unresolved = await db.from('agent_email_attempts').select('id').eq('user_id', userId).eq('to_email', input.to)
    .in('status', ['sending', 'acceptance_unknown', 'accepted_by_provider']).limit(1);
  if (unresolved.error) throw databaseError(unresolved.error);
  if (unresolved.data?.length) throw new WorkspaceError('A prior send to this contact is unresolved. Reconcile Gmail Sent history before composing another send.', 409);
  let threadId: string | undefined;
  let reply: { messageId: string; references: string } | undefined;
  if (options.replyId) {
    if (!isUuid(options.replyId)) throw new WorkspaceError('Choose a valid message to reply to.', 400);
    const target = await db.from('communication_log').select('client_id,direction,subject,metadata').eq('id', options.replyId).single();
    if (target.error) throw databaseError(target.error);
    const metadata = isRecord(target.data.metadata) ? target.data.metadata : {};
    if (target.data.client_id !== options.clientId || (options.leadId && metadata.lead_id !== options.leadId && !options.clientId)) throw new WorkspaceError('The selected reply belongs to a different contact.', 400);
    const intended = target.data.direction === 'inbound' ? metadata.from : metadata.to;
    if (typeof intended !== 'string' || intended.toLowerCase() !== input.to.toLowerCase()) throw new WorkspaceError('The selected message uses a different recipient address. Review the current contact email before sending.', 409);
    const link = await db.from('gmail_message_links').select('gmail_thread_id').eq('connection_id', connection.id).eq('communication_id', options.replyId).maybeSingle();
    if (link.error) throw databaseError(link.error);
    const normalizedSubject = (value: string): string => value.replace(/^(?:re:\s*)+/i, '').trim().toLowerCase();
    if (link.data && typeof metadata.rfc_message_id === 'string' && normalizedSubject(input.subject) === normalizedSubject(String(target.data.subject ?? ''))) {
      threadId = link.data.gmail_thread_id;
      reply = { messageId: metadata.rfc_message_id, references: typeof metadata.references === 'string' ? metadata.references : '' };
    }
    // A teammate's mailbox thread is never impersonated: without an own-mailbox
    // mapping this is deliberately a new Gmail thread.
  }
  const raw = Buffer.from(agentMime(signed, connection.email, sender.name, rfc, reply)).toString('base64url');
  const claimed = await db.from('agent_email_attempts').insert({
    id: options.attemptId, user_id: userId, connection_id: connection.id, client_id: options.clientId, lead_id: options.leadId,
    to_email: input.to, subject: input.subject, body, content_hash: hash, rfc_message_id: rfc,
    attachments: input.attachments?.map((file) => ({ name: file.filename, size: Buffer.from(file.content, 'base64').length, imported: true })) ?? [],
    ...(options.salesTemplate ? { sales_template: options.salesTemplate } : {}),
    ...(signed.bodyDocument || signed.signatureDocument || signed.signatureRows ? { email_formatting: {
      bodyDocument: signed.bodyDocument, signatureDocument: signed.signatureDocument, signatureRows: signed.signatureRows,
    } } : {}),
  });
  if (claimed.error) {
    if (claimed.error.code === 'PT429') {
      throw new WorkspaceError('This mailbox reached its CRM limit of 50 messages in 24 hours. Schedule later or wait for the limit to reset.', 429);
    }
    console.error('[gmail/send-claim]', claimed.error);
    throw new WorkspaceError(claimed.error.code === '23505' ? 'Another request claimed this send. Refresh before retrying.' : 'The send could not be claimed. No provider request was made.', 409);
  }
  let accepted: unknown;
  try {
    accepted = await gmailRequest(db, connection.id, '/messages/send', {
      method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    });
    if (!isRecord(accepted) || typeof accepted.id !== 'string' || typeof accepted.threadId !== 'string') throw new Error('Invalid Gmail acceptance response');
  } catch {
    const uncertain = await db.from('agent_email_attempts').update({ status: 'acceptance_unknown' }).eq('id', options.attemptId).eq('status', 'sending');
    if (uncertain.error) throw new WorkspaceError('Gmail acceptance is uncertain and could not be saved. Do not resend.', 503);
    throw new WorkspaceError(connection.sync_enabled
      ? 'Gmail acceptance is uncertain. Do not resend; check Sent history and synchronization.'
      : 'Gmail acceptance is uncertain. Check Gmail Sent and contact your administrator; send-only access cannot reconcile mailbox history. Do not resend.', 503);
  }
  const recorded = await db.from('agent_email_attempts').update({
    status: 'accepted_by_provider', provider_message_id: accepted.id, provider_thread_id: accepted.threadId, accepted_at: new Date().toISOString(),
  }).eq('id', options.attemptId).eq('status', 'sending');
  if (recorded.error) throw new WorkspaceError('Gmail accepted the email, but acceptance could not be saved. Do not resend.', 503);
  const saved = await db.rpc('finalize_agent_email', { p_attempt_id: options.attemptId });
  if (saved.error) throw new WorkspaceError('Gmail accepted the email; recording is incomplete. Retry only the same request ID to finish recording.', 503);
  return { id: saved.data as string, provider: 'gmail', status: 'accepted_by_provider' };
}
