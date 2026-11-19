import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { alertInboundMessage, inboundEventKey, ingestInboundMessage, resolveInboundSender } from '../../../../lib/message-alerts';
import { handleInboundReply } from '../../../../lib/outreach-engine';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { emailHtmlToText } from '../../../../lib/email-text';
import { completeReplyCheck } from '../../../../lib/email-setup';

const deliveryTypes = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed', 'email.opened']);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ message: 'Email event verification is not configured.' }, { status: 503 });
  if (Number(request.headers.get('content-length') ?? 0) > 262144) return NextResponse.json({ message: 'Email event is too large.' }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 262144) return NextResponse.json({ message: 'Email event is too large.' }, { status: 413 });
  let event: unknown;
  try {
    event = new Webhook(secret).verify(raw, {
      'svix-id': request.headers.get('svix-id') ?? '',
      'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
      'svix-signature': request.headers.get('svix-signature') ?? '',
    });
  } catch {
    return NextResponse.json({ message: 'Email event signature is invalid.' }, { status: 401 });
  }
  try {
    if (!isRecord(event) || typeof event.type !== 'string' || !isRecord(event.data)) throw new WorkspaceError('Email event is not valid.', 400);
    if (!deliveryTypes.has(event.type) && event.type !== 'email.received') return NextResponse.json({ ignored: true });
    const data = event.data;
    if (typeof data.email_id !== 'string' || !isUuid(data.email_id)) throw new WorkspaceError('Email event has no valid message identity.', 400);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Email events are temporarily unavailable. Resend should retry.', 503);
    if (event.type === 'email.received') {
      const key = process.env.RESEND_RECEIVING_API_KEY ?? process.env.RESEND_API_KEY;
      if (!key) throw new WorkspaceError('Email reply retrieval is not configured.', 503);
      const response = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new WorkspaceError('The email reply could not be retrieved. Resend should retry.', 502);
      const mail: unknown = await response.json();
      if (!isRecord(mail) || typeof mail.from !== 'string'
        || !Array.isArray(mail.to) || !mail.to.every((to: unknown) => typeof to === 'string')) {
        throw new WorkspaceError('The reply needs a readable plain-text message. Review it in Resend; it has not been processed.', 422);
      }
      const text = typeof mail.text === 'string' && mail.text.trim() ? mail.text : typeof mail.html === 'string' ? emailHtmlToText(mail.html) : '';
      const attachmentCount = Array.isArray(mail.attachments) ? mail.attachments.length : 0;
      const attachmentNotice = attachmentCount ? `\n\nThis reply includes ${attachmentCount} attachment(s). Review them in the monitored mailbox; they have not been copied into the CRM.` : '';
      const body = `${text}${attachmentNotice}`;
      if (!body.trim() || body.length > 2000000) throw new WorkspaceError('The reply is empty or too large. Review it in your mailbox; it has not been processed.', 422);
      const inbound = process.env.RESEND_INBOUND_ADDRESS?.trim().toLowerCase();
      if (!inbound) throw new WorkspaceError('The Resend receiving address is not configured.', 503);
      const recipients = [...mail.to, ...(Array.isArray(mail.received_for) ? mail.received_for : [])];
      if (!recipients.some((address: unknown) => typeof address === 'string' && address.toLowerCase() === inbound)) {
        return NextResponse.json({ ignored: true });
      }
      const from = mail.from.match(/<([^>]+)>/)?.[1] ?? mail.from;
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) throw new WorkspaceError('The reply sender is invalid.', 422);
      if (await completeReplyCheck(db, {
        subject: typeof mail.subject === 'string' ? mail.subject : '', from, providerId: data.email_id,
      })) return NextResponse.json({ ok: true, setup_check: true });
      const sender = await resolveInboundSender(db, { email: from.toLowerCase() });
      const log = await ingestInboundMessage(db, {
        eventKey: inboundEventKey('email', `resend:${data.email_id}`, {}), sender, channel: 'email',
        from: from.toLowerCase(), to: mail.to.join(', '), subject: typeof mail.subject === 'string' ? mail.subject : 'Email reply',
        body, sentAt: typeof mail.created_at === 'string' ? mail.created_at : new Date().toISOString(),
        providerId: data.email_id,
      });
      await handleInboundReply(db, { clientId: sender.clientId, fromEmail: from.toLowerCase(), body, logId: log.id });
      await alertInboundMessage(db, { logId: log.id, sender, channel: 'email', fromAddress: from.toLowerCase(),
        subject: typeof mail.subject === 'string' ? mail.subject : 'Email reply', body });
    } else {
      if (typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))) throw new WorkspaceError('Email event has no valid date.', 400);
      const tags = isRecord(data.tags) ? data.tags : {};
      const result = await db.rpc('record_resend_event', {
        p_event_id: request.headers.get('svix-id'), p_provider_id: data.email_id,
        p_type: event.type, p_occurred_at: event.created_at,
        p_attempt_id: isUuid(tags.crm_attempt) ? tags.crm_attempt : null,
      });
      if (result.error) throw databaseError(result.error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'email/resend-event'); }
}
