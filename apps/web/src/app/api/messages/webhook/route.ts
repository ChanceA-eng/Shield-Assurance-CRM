import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface InboundPayload {
  from?: string;
  sender?: string;
  to?: string;
  recipient?: string;
  subject?: string;
  text?: string;
  html?: string;
  'body-plain'?: string;
  'stripped-text'?: string;
  Date?: string;
  date?: string;
  'message-id'?: string;
  MessageID?: string;
}

function normalize(value?: string | null): string {
  return (value ?? '').trim();
}

function extractEmail(raw?: string | null): string {
  const value = normalize(raw).toLowerCase();
  if (!value) return '';
  const match = value.match(/<([^>]+)>/);
  return normalize(match?.[1] ?? value).toLowerCase();
}

function parseDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseWebhookBody(payload: InboundPayload): { from: string; to: string; subject: string; body: string; sentAt: string } {
  const from = extractEmail(payload.from ?? payload.sender);
  const to = extractEmail(payload.to ?? payload.recipient);
  const subject = normalize(payload.subject) || 'Reply from client';

  const body =
    normalize(payload.text) ||
    normalize(payload['body-plain']) ||
    normalize(payload['stripped-text']) ||
    normalize(payload.html) ||
    '(No body provided by inbound mail webhook)';

  const sentAt = parseDate(payload.date ?? payload.Date);

  return { from, to, subject, body, sentAt };
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const bearer = request.headers.get('authorization') ?? '';
  if (bearer === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get('x-webhook-secret') ?? '';
  if (headerSecret.trim() === secret) return true;

  const querySecret = request.nextUrl.searchParams.get('secret') ?? '';
  return querySecret.trim() === secret;
}

async function readPayload(request: NextRequest): Promise<InboundPayload> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as InboundPayload;
  }

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const payload: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        payload[key] = value;
      }
    }
    return payload as InboundPayload;
  }

  return (await request.json().catch(() => ({}))) as InboundPayload;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: 'Unauthorized webhook request.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = await readPayload(request);
  const parsed = parseWebhookBody(payload);

  if (!parsed.from) {
    return NextResponse.json({ message: 'Inbound payload is missing a valid from email.' }, { status: 400 });
  }

  const clientLookup = await supabase
    .from('clients')
    .select('id,email')
    .ilike('email', parsed.from)
    .maybeSingle();

  if (clientLookup.error) {
    return NextResponse.json({ message: clientLookup.error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('communication_log')
    .insert([
      {
        client_id: clientLookup.data?.id ?? null,
        channel: 'email',
        direction: 'inbound',
        subject: parsed.subject,
        body: parsed.body,
        automation_type: 'inbound_webhook',
        sent_at: parsed.sentAt,
      },
    ])
    .select('id,client_id,channel,direction,subject,sent_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      matchedClient: Boolean(clientLookup.data?.id),
      from: parsed.from,
      to: parsed.to,
      communication: data,
    },
    { status: 200 },
  );
}
