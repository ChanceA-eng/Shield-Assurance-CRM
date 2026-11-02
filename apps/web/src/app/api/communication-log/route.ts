import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { sendOutboundEmail } from '../../../lib/email-adapter';
import { appendAgencySignature } from '../../../lib/agency-signature';
import { handleInboundReply } from '../../../lib/outreach-engine';
import {
  conversationKeyForRow,
  formatConversationKey,
  parseConversationKey,
  rowLeadId,
  type ConversationLogRow,
  type ConversationRef,
} from '../../../lib/conversations';
import { SMS_UNAVAILABLE, resolveOutboundEmailRecipient } from '../../../lib/message-delivery';
import {
  CLIENT_FILE_COLUMNS,
  classifyClientFile,
  downloadStoredObject,
  isUuid,
  storedLocation,
  type ClientFileRecord,
} from '../../../lib/account-documents';

const THREAD_LIMIT = 200;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_READ_IDS = 500;

type LogRow = ConversationLogRow & Record<string, unknown>;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Loads one canonical conversation thread (newest first). */
async function loadThread(supabase: SupabaseClient, ref: ConversationRef, offset: number, limit: number): Promise<{ rows: LogRow[]; total: number; error: string | null; status?: number }> {
  if (ref.kind === 'lead') {
    const { data: lead, error: leadError } = await supabase.from('leads').select('id,account_id').eq('id', ref.id).maybeSingle<{ id: string; account_id: string | null }>();
    if (leadError) return { rows: [], total: 0, error: leadError.message };
    if (!lead) return { rows: [], total: 0, error: 'Lead not found.', status: 404 };
    if (lead.account_id) ref = { kind: 'client', id: lead.account_id };
  }
  const { data, count, error } = await supabase.from('canonical_communications').select('*', { count: 'exact' })
    .eq('conversation_key', formatConversationKey(ref)).order('sent_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  return { rows: (data ?? []) as LogRow[], total: count ?? 0, error: error?.message ?? null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return json({ message: 'Supabase is not configured.' }, 503);

  const params = request.nextUrl.searchParams;
  const rawKey = params.get('conversation_key');
  const leadId = params.get('lead_id');
  const clientId = params.get('client_id') ?? params.get('contact_id');
  const offset = Number(params.get('offset') ?? '0');
  const limit = Number(params.get('limit') ?? String(THREAD_LIMIT));
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return json({ message: 'Choose a valid message page.' }, 400);

  let ref: ConversationRef | null = null;
  if (rawKey) {
    ref = parseConversationKey(rawKey);
    if (!ref) return json({ message: 'Unknown conversation key.' }, 400);
  } else if (leadId) {
    if (!isUuid(leadId)) return json({ message: 'A valid lead id is required.' }, 400);
    ref = { kind: 'lead', id: leadId };
  } else if (clientId) {
    if (!isUuid(clientId)) return json({ message: 'A valid account id is required.' }, 400);
    ref = { kind: 'client', id: clientId };
  }

  if (ref) {
    const thread = await loadThread(supabase, ref, offset, limit);
    if (thread.error) return json({ message: thread.error }, thread.status ?? 500);
    return NextResponse.json(thread.rows, { headers: { 'X-Total-Count': String(thread.total), 'X-Next-Offset': offset + thread.rows.length < thread.total ? String(offset + thread.rows.length) : '' } });
  }

  const query = supabase.from('communication_log').select('*').order('sent_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) return json({ message: error.message }, 500);
  return json(data ?? [], 200);
}

interface PostPayload {
  client_id?: string | null;
  lead_id?: string | null;
  conversation_key?: string | null;
  channel?: string;
  direction?: string;
  subject?: string | null;
  body?: string;
  automation_type?: string;
  to?: string | null;
  attachments?: Array<{ filename?: string; content?: string; type?: string }>;
  profile_file_ids?: string[];
  /** Legacy shape; only ids are trusted, links/bytes are always loaded from the account. */
  profile_files?: Array<{ id?: string }>;
}

interface Attachment {
  filename: string;
  content: string;
  type: string;
}

async function profileFileAttachments(
  supabase: SupabaseClient,
  clientId: string | null,
  ids: string[],
): Promise<{ ok: true; links: Array<{ name: string; url: string }>; attachments: Attachment[] } | { ok: false; status: number; message: string }> {
  if (ids.length === 0) return { ok: true, links: [], attachments: [] };
  if (!clientId) return { ok: false, status: 400, message: 'Account documents can only be attached to messages on that account.' };
  const { data, error } = await supabase.from('client_files').select(CLIENT_FILE_COLUMNS).eq('client_id', clientId).in('id', ids);
  if (error) return { ok: false, status: 500, message: error.message };
  const records = (data ?? []) as ClientFileRecord[];
  if (records.length !== ids.length) return { ok: false, status: 400, message: 'One or more selected documents are not on this account.' };

  const links: Array<{ name: string; url: string }> = [];
  const attachments: Attachment[] = [];
  let total = 0;
  for (const record of records) {
    const kind = classifyClientFile(record);
    if (kind === 'link' && record.file_url) {
      links.push({ name: record.file_name, url: record.file_url });
      continue;
    }
    const location = storedLocation(record);
    if (!location) return { ok: false, status: 400, message: `"${record.file_name}" was never uploaded and cannot be attached.` };
    total += location.size;
    if (total > MAX_ATTACHMENT_BYTES) return { ok: false, status: 413, message: 'Selected documents exceed the 15 MB email attachment limit.' };
    const downloaded = await downloadStoredObject(supabase, location);
    if (!downloaded.ok) return { ok: false, status: downloaded.status, message: `"${record.file_name}": ${downloaded.message}` };
    attachments.push({
      filename: record.file_name,
      content: Buffer.from(await downloaded.blob.arrayBuffer()).toString('base64'),
      type: location.content_type,
    });
  }
  return { ok: true, links, attachments };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return json({ message: 'Supabase is not configured.' }, 503);

  let payload: PostPayload;
  try {
    payload = (await request.json()) as PostPayload;
  } catch {
    return json({ message: 'Invalid JSON body.' }, 400);
  }

  const channel = payload.channel;
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const automationType = payload.automation_type?.trim() || 'manual';
  const direction = payload.direction ?? 'outbound';
  if (channel !== 'email' && channel !== 'sms') return json({ message: 'channel must be email or sms.' }, 400);
  if (direction !== 'outbound' && direction !== 'inbound') return json({ message: 'direction must be outbound or inbound.' }, 400);
  if (!body) return json({ message: 'Message body is required.' }, 400);
  const subject = payload.subject?.trim() || (channel === 'email' ? 'Message from Shield Assurance' : 'Text message');

  if (direction === 'inbound') {
    // Manually recorded inbound message (e.g. a reply received outside the CRM). Nothing is sent.
    const clientId = isUuid(payload.client_id) ? payload.client_id : null;
    const leadId = isUuid(payload.lead_id) ? payload.lead_id : null;
    if (!clientId && !leadId) return json({ message: 'Choose the account or lead this message came from.' }, 400);
    const { data, error } = await supabase
      .from('communication_log')
      .insert([{
        client_id: clientId,
        channel,
        direction,
        subject,
        body,
        automation_type: automationType,
        sent_at: new Date().toISOString(),
        read_at: new Date().toISOString(),
        metadata: { recorded_manually: true, recorded_by: apiActorName(session.user), ...(leadId ? { lead_id: leadId } : {}) },
      }])
      .select('*')
      .single();
    if (error) return json({ message: error.message }, 500);
    if (clientId) {
      const touched = await supabase.from('clients').update({ last_activity_at: new Date().toISOString() }).eq('id', clientId);
      if (touched.error) console.error('[communication-log] last_activity_at update failed', touched.error.message);
    }
    await handleInboundReply(supabase, { clientId, body });
    return json({ ...data, delivery: 'recorded_inbound' }, 201);
  }

  if (channel === 'sms') return json({ message: SMS_UNAVAILABLE.message, code: SMS_UNAVAILABLE.code }, SMS_UNAVAILABLE.status);

  const resolved = await resolveOutboundEmailRecipient(supabase, {
    clientId: isUuid(payload.client_id) ? payload.client_id : null,
    leadId: isUuid(payload.lead_id) ? payload.lead_id : null,
    conversationKey: payload.conversation_key ?? null,
    to: payload.to ?? null,
  });
  if (!resolved.ok) return json({ message: resolved.message, code: resolved.code }, resolved.status);
  const recipient = resolved.recipient;

  const requestedIds = [
    ...(payload.profile_file_ids ?? []),
    ...(payload.profile_files ?? []).map((file) => file.id ?? ''),
  ].filter((id, index, all): id is string => isUuid(id) && all.indexOf(id) === index);
  const profileFiles = await profileFileAttachments(supabase, recipient.clientId, requestedIds);
  if (!profileFiles.ok) return json({ message: profileFiles.message }, profileFiles.status);

  const uploaded = (payload.attachments ?? [])
    .map((attachment) => ({
      filename: attachment.filename?.trim() || '',
      content: attachment.content?.trim() || '',
      type: attachment.type?.trim() || 'application/octet-stream',
    }))
    .filter((attachment) => attachment.filename && attachment.content);
  const attachments = [...uploaded, ...profileFiles.attachments];
  const attachmentBytes = attachments.reduce((sum, item) => sum + Math.floor((item.content.length * 3) / 4), 0);
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) return json({ message: 'Attachments exceed the 15 MB email limit.' }, 413);

  const linksBlock = profileFiles.links.length > 0
    ? `\n\nDocument links:\n${profileFiles.links.map((item) => `- ${item.name}: ${item.url}`).join('\n')}`
    : '';
  const messageBody = appendAgencySignature(`${body}${linksBlock}`, automationType.toLowerCase() === 'manual' ? 'personal' : 'system');

  let provider: string;
  try {
    provider = await sendOutboundEmail({ to: recipient.to, subject, body: messageBody, attachments });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown email delivery failure';
    return json({ message: `Email was not sent: ${detail}`, code: 'provider_rejected' }, 502);
  }

  const acceptedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('communication_log')
    .insert([{
      client_id: recipient.clientId,
      channel: 'email',
      direction: 'outbound',
      subject,
      body: messageBody,
      automation_type: automationType,
      sent_at: acceptedAt,
      read_at: null,
      metadata: {
        to: recipient.to,
        ...(recipient.leadId ? { lead_id: recipient.leadId } : {}),
        delivery_status: 'accepted_by_provider',
        provider,
        sent_by: apiActorName(session.user),
        attachment_count: attachments.length,
      },
    }])
    .select('*')
    .single();

  if (error || !data) {
    return json({
      message: `The email was accepted by ${provider}, but it could not be saved to the conversation history: ${error?.message ?? 'no row returned'}. Do not resend; record it manually.`,
      code: 'log_failed',
      delivery: 'accepted_by_provider',
      provider,
    }, 500);
  }

  return json({
    ...data,
    conversation_key: conversationKeyForRow(data as LogRow),
    delivery: 'accepted_by_provider',
    provider,
  }, 201);
}

/** Marks specific inbound messages read once a user has actually viewed them. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return json({ message: 'Supabase is not configured.' }, 503);

  let payload: { read_ids?: unknown };
  try {
    payload = (await request.json()) as { read_ids?: unknown };
  } catch {
    return json({ message: 'Invalid JSON body.' }, 400);
  }
  if (!Array.isArray(payload.read_ids)) return json({ message: 'read_ids must be an array of message ids.' }, 400);
  const ids = [...new Set(payload.read_ids.filter(isUuid))];
  if (payload.read_ids.some((id) => !isUuid(id))) return json({ message: 'read_ids must contain message ids only.' }, 400);
  if (ids.length > MAX_READ_IDS) return json({ message: `Mark at most ${MAX_READ_IDS} messages at a time.` }, 400);
  if (ids.length === 0) return json({ updated: 0, ids: [] }, 200);

  const { data, error } = await supabase
    .from('communication_log')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .eq('direction', 'inbound')
    .is('read_at', null)
    .select('id');
  if (error) return json({ message: error.message }, 500);

  const updated = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  return json({ updated: updated.length, ids: updated }, 200);
}
