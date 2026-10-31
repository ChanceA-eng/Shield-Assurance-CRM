import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { alertInboundMessage, resolveInboundSender, twilioSignature } from '../../../../lib/message-alerts';

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
  if (!from) return twiml();

  const sender = await resolveInboundSender(supabase, { phone: from });

  const { error } = await supabase.from('communication_log').insert([
    {
      client_id: sender.clientId,
      channel: 'sms',
      direction: 'inbound',
      subject: 'Text message',
      body,
      automation_type: 'inbound_sms',
      sent_at: new Date().toISOString(),
      metadata: { from, to: params.To ?? null, message_sid: params.MessageSid ?? null, lead_id: sender.leadId },
    },
  ]);
  if (error) {
    console.error('[sms-webhook] failed to log inbound text', error.message);
    return twiml(500);
  }

  if (sender.clientId) {
    await supabase.from('clients').update({ last_activity_at: new Date().toISOString() }).eq('id', sender.clientId);
  }

  await alertInboundMessage(supabase, { sender, channel: 'sms', fromAddress: from, subject: null, body });
  return twiml();
}
