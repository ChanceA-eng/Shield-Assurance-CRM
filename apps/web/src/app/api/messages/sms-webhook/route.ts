import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { alertInboundMessage, inboundEventKey, ingestInboundMessage, resolveInboundSender, twilioSignature } from '../../../../lib/message-alerts';
import { handleInboundReply } from '../../../../lib/outreach-engine';

export const runtime = 'nodejs';

/**
 * Twilio inbound SMS webhook.
 * Setup: Twilio Console > Phone Numbers > your number > Messaging >
 * "A message comes in" = Webhook, HTTP POST, https://<crm-domain>/api/messages/sms-webhook
 * Requests are verified with the X-Twilio-Signature header and TWILIO_AUTH_TOKEN.
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200): NextResponse {
  return new NextResponse(EMPTY_TWIML, { status, headers: { 'Content-Type': 'text/xml' } });
}

function publicUrl(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  return `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    return NextResponse.json({ message: 'TWILIO_AUTH_TOKEN is not configured.' }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: 'Expected form-encoded Twilio payload.' }, { status: 400 });
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }

  const provided = request.headers.get('x-twilio-signature') ?? '';
  if (!provided || !signatureMatches(twilioSignature(authToken, publicUrl(request), params), provided)) {
    return NextResponse.json({ message: 'Invalid Twilio signature.' }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const from = (params.From ?? '').trim();
  const body = (params.Body ?? '').trim() || '(empty text message)';
  if (!from || !params.MessageSid?.trim()) {
    return NextResponse.json({ message: 'Twilio From and MessageSid are required.' }, { status: 400 });
  }

  try {
    const sender = await resolveInboundSender(supabase, { phone: from });
    const data = await ingestInboundMessage(supabase, {
      eventKey: inboundEventKey('sms', params.MessageSid, null), sender, channel: 'sms',
      from, to: params.To ?? null, subject: 'Text message', body,
      sentAt: new Date().toISOString(), providerId: params.MessageSid,
    });
    await handleInboundReply(supabase, { clientId: sender.clientId, fromPhone: from, body, logId: data.id });
    await alertInboundMessage(supabase, { logId: data.id, sender, channel: 'sms', fromAddress: from, subject: null, body });
    return twiml();
  } catch (error) {
    console.error('[sms-webhook] inbound processing failed', error instanceof Error ? error.message : error);
    return twiml(500);
  }
}
