import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { addInstantlyBlocklistEntry } from '../../../../lib/instantly';
import { databaseError } from '../../../../lib/workspace-api';

export const runtime = 'nodejs';

interface InstantlyEvent {
  event_type: string;
  campaign_id: string;
  lead_email?: string;
  email_account?: string;
  reply_subject?: string;
  reply_text?: string;
  reply_body?: string;
  timestamp?: string;
  id?: string;
  event_id?: string;
  email_id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function webhookAuthorized(value: string | null): boolean {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 32 || !value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseEvent(value: unknown): InstantlyEvent | null {
  if (!isRecord(value) || typeof value.event_type !== 'string' || value.event_type.length > 80
    || typeof value.campaign_id !== 'string' || value.campaign_id.length > 200) return null;
  if (value.lead_email !== undefined && typeof value.lead_email !== 'string') return null;
  return {
    event_type: value.event_type.trim().toLowerCase(),
    campaign_id: value.campaign_id.trim(),
    ...(typeof value.lead_email === 'string' ? { lead_email: value.lead_email.trim().toLowerCase() } : {}),
    ...(typeof value.email_account === 'string' ? { email_account: value.email_account.slice(0, 320) } : {}),
    ...(typeof value.reply_subject === 'string' ? { reply_subject: value.reply_subject.slice(0, 998) } : {}),
    ...(typeof value.reply_text === 'string' ? { reply_text: value.reply_text.slice(0, 50000) } : {}),
    ...(typeof value.reply_body === 'string' ? { reply_body: value.reply_body.slice(0, 50000) } : {}),
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
    ...(typeof value.id === 'string' ? { id: value.id.slice(0, 200) } : {}),
    ...(typeof value.event_id === 'string' ? { event_id: value.event_id.slice(0, 200) } : {}),
    ...(typeof value.email_id === 'string' ? { email_id: value.email_id.slice(0, 200) } : {}),
  };
}

function requestsEmailOptOut(body: string): boolean {
  return /(\bunsubscribe\b|\bopt[ -]?out\b|^\s*stop\s*$|\bstop\s+(sending|emailing|texting)\b|remove me)/i.test(body);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!webhookAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 1_000_000) return NextResponse.json({ message: 'Webhook payload is too large.' }, { status: 413 });

  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Webhook processing is temporarily unavailable.' }, { status: 503 });
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) return NextResponse.json({ message: 'Webhook payload is too large.' }, { status: 413 });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return NextResponse.json({ message: 'Webhook payload must be valid JSON.' }, { status: 400 }); }
    const event = parseEvent(parsed);
    if (!event) return NextResponse.json({ message: 'Webhook event is incomplete.' }, { status: 400 });

    const { data: campaign, error: campaignError } = await db.from('instantly_campaigns')
      .select('id').eq('provider_campaign_id', event.campaign_id).maybeSingle<{ id: string }>();
    if (campaignError) throw databaseError(campaignError);
    if (!campaign) return NextResponse.json({ ok: true, ignored: true });

    const email = event.lead_email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(event.lead_email)
      ? event.lead_email : null;
    let leadId: string | null = null;
    if (email) {
      const { data: lead, error: leadError } = await db.from('instantly_campaign_leads')
        .select('lead_id').eq('campaign_id', campaign.id).eq('email', email).maybeSingle<{ lead_id: string }>();
      if (leadError) throw databaseError(leadError);
      leadId = lead?.lead_id ?? null;
    }

    const providerEventId = event.event_id ?? event.id;
    const eventKey = createHash('sha256')
      .update(providerEventId
        ? `${providerEventId}\u0000${event.campaign_id}\u0000${event.event_type}\u0000${email ?? ''}`
        : raw)
      .digest('hex');
    const timestamp = event.timestamp && Number.isFinite(Date.parse(event.timestamp))
      ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    const reply = event.reply_text ?? event.reply_body ?? null;
    const { data: inserted, error: recordError } = await db.rpc('record_instantly_campaign_event', {
      p_event_key: eventKey,
      p_campaign_id: campaign.id,
      p_lead_id: leadId,
      p_event_type: event.event_type,
      p_email: email,
      p_email_account: event.email_account ?? null,
      p_subject: event.reply_subject ?? null,
      p_body: reply,
      p_event_at: timestamp,
      p_provider_message_id: event.email_id ?? providerEventId ?? null,
    });
    if (recordError) throw databaseError(recordError);

    if (email && (event.event_type === 'lead_unsubscribed'
      || (event.event_type === 'reply_received' && reply !== null && requestsEmailOptOut(reply)))) {
      await addInstantlyBlocklistEntry(email);
    }
    return NextResponse.json({ ok: true, duplicate: inserted === false });
  } catch (error) {
    console.error('[instantly/webhook]', error);
    return NextResponse.json({ message: 'Webhook event could not be processed.' }, { status: 500 });
  }
}
