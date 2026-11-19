import type { SupabaseClient } from '@supabase/supabase-js';
import { gmailRequest, GmailHttpError, type GmailConnection } from './gmail-provider';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';
import { emailHtmlToText } from './email-text';

interface Contact { email: string; clientId: string | null; leadId: string | null }
interface GmailHeader { name: string; value: string }
interface GmailPart {
  mimeType?: string; filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string; threadId: string; internalDate: string; labelIds?: string[]; payload: GmailPart;
}
interface SyncConnection extends GmailConnection {
  sync_lease_token: string;
  watch_expires_at: string | null;
  watch_renewed_at: string | null;
}
const emailPattern = /^[^\s@<>(),;"]+@[^\s@<>(),;"]+\.[^\s@<>(),;"]+$/;

export function gmailAddresses(value: string): string[] {
  const found = value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? [];
  return [...new Set(found.map((email) => email.toLowerCase()).filter((email) => emailPattern.test(email)))];
}
export function gmailHeader(message: GmailMessage, name: string): string {
  return message.payload.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
export function gmailMessages(value: unknown): GmailMessage[] {
  if (!isRecord(value) || !Array.isArray(value.messages)) throw new WorkspaceError('Gmail returned an invalid thread.', 503);
  return value.messages.map((message: unknown) => {
    if (!isRecord(message) || typeof message.id !== 'string' || typeof message.threadId !== 'string' ||
      typeof message.internalDate !== 'string' || !Number.isFinite(Number(message.internalDate)) || !isRecord(message.payload)) {
      throw new WorkspaceError('Gmail returned an invalid message.', 503);
    }
    // Validate recursive parts before consuming untrusted provider fields.
    function part(raw: Record<string, unknown>): GmailPart {
      if (raw.mimeType !== undefined && typeof raw.mimeType !== 'string' || raw.filename !== undefined && typeof raw.filename !== 'string') throw new WorkspaceError('Invalid Gmail MIME type.', 503);
      const headers = raw.headers === undefined ? undefined : Array.isArray(raw.headers) ? raw.headers.map((header: unknown) => {
        if (!isRecord(header) || typeof header.name !== 'string' || typeof header.value !== 'string') throw new WorkspaceError('Invalid Gmail headers.', 503);
        return { name: header.name, value: header.value };
      }) : (() => { throw new WorkspaceError('Invalid Gmail headers.', 503); })();
      const children = raw.parts === undefined ? undefined : Array.isArray(raw.parts) ? raw.parts.map((child: unknown) => {
        if (!isRecord(child)) throw new WorkspaceError('Invalid Gmail MIME part.', 503);
        return part(child);
      }) : (() => { throw new WorkspaceError('Invalid Gmail MIME parts.', 503); })();
      const body = isRecord(raw.body) ? raw.body : {};
      if (body.data !== undefined && typeof body.data !== 'string' || body.size !== undefined && typeof body.size !== 'number') throw new WorkspaceError('Invalid Gmail MIME body.', 503);
      return { mimeType: raw.mimeType, filename: raw.filename, headers, parts: children, body: { data: body.data, size: body.size } };
    }
    return { id: message.id, threadId: message.threadId, internalDate: message.internalDate, payload: part(message.payload) };
  });
}
async function renewSync(db: SupabaseClient, connection: SyncConnection): Promise<void> {
  const renewed = await db.rpc('renew_gmail_sync', { p_connection_id: connection.id, p_lease_token: connection.sync_lease_token });
  if (renewed.error) throw databaseError(renewed.error);
  if (!renewed.data) throw new WorkspaceError('Gmail synchronization lease expired; retry safely.', 409);
}

export function gmailContent(part: GmailPart): { text: string; attachments: Array<{ name: string; size: number; imported: false }> } {
  const attachments: Array<{ name: string; size: number; imported: false }> = [];
  const plain: string[] = [];
  const html: string[] = [];
  function visit(item: GmailPart): void {
    if (item.filename) {
      attachments.push({ name: item.filename, size: item.body?.size ?? 0, imported: false });
      return;
    }
    if ((item.mimeType === 'text/plain' || item.mimeType === 'text/html') && (item.body?.size ?? 0) > 0 && !item.body?.data) {
      throw new WorkspaceError('A matched Gmail text body is stored separately and was not imported. Review it in Gmail.', 422);
    }
    if (item.body?.data) {
      const bytes = Buffer.from(item.body.data, 'base64url');
      if (bytes.length > 2000000) throw new WorkspaceError('A matched Gmail message exceeds the supported 2 MB text size. Review it in Gmail.', 422);
      const value = bytes.toString('utf8');
      if (item.mimeType === 'text/plain') plain.push(value);
      if (item.mimeType === 'text/html') html.push(value);
    }
    for (const child of item.parts ?? []) visit(child);
  }
  visit(part);
  // Persist/display plain text only; never render remote HTML or load tracking URLs.
  const text = plain.length ? plain.join('\n') : emailHtmlToText(html.join('\n'));
  if (text.length > 2000000) throw new WorkspaceError('A matched Gmail message exceeds the supported text size. Review it in Gmail.', 422);
  return { text, attachments };
}

async function contacts(db: SupabaseClient): Promise<Map<string, Contact[]>> {
  const result = new Map<string, Contact[]>();
  for (const table of ['clients', 'leads'] as const) {
    for (let offset = 0; ; offset += 200) {
      const page = await db.from(table).select(table === 'clients' ? 'id,email' : 'id,email,account_id').order('id').range(offset, offset + 199)
        .returns<Array<{ id: string; email: string | null; account_id?: string | null }>>();
      if (page.error) throw databaseError(page.error);
      for (const row of page.data ?? []) {
        const email = String(row.email ?? '').trim().toLowerCase();
        if (!emailPattern.test(email)) continue;
        const contact: Contact = { email, clientId: table === 'clients' ? row.id : row.account_id ?? null, leadId: table === 'leads' ? row.id : null };
        result.set(email, [...(result.get(email) ?? []), contact]);
      }
      if ((page.data ?? []).length < 200) break;
    }
  }
  return result;
}

export function matchGmailThread(messages: GmailMessage[], mailbox: string, known: Map<string, Contact[]>): Contact | null {
  if (!messages.length || messages.some((message) => gmailAddresses(gmailHeader(message, 'From')).length !== 1)) return null;
  const external = new Set<string>();
  for (const message of messages) {
    for (const field of ['From', 'To', 'Cc', 'Bcc']) {
      for (const address of gmailAddresses(gmailHeader(message, field))) if (address !== mailbox) external.add(address);
    }
  }
  const candidates = Array.from(external).flatMap((address) => known.get(address) ?? []);
  const identities = new Set(candidates.map((contact) => contact.clientId ? `client:${contact.clientId}` : `lead:${contact.leadId}`));
  if (identities.size !== 1 || Array.from(external).some((address) => !known.has(address))) return null;
  return candidates.find((candidate) => candidate.leadId) ?? candidates[0] ?? null;
}

async function importThread(
  db: SupabaseClient, connection: SyncConnection, id: string, known: Map<string, Contact[]>, historical: boolean,
  liveMessageIds?: ReadonlySet<string>,
): Promise<boolean> {
  await renewSync(db, connection);
  let raw: unknown;
  try { raw = await gmailRequest(db, connection.id, `/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`); }
  catch (error) {
    if (!(error instanceof GmailHttpError) || error.providerStatus !== 404) throw error;
    const unavailable = await db.from('gmail_thread_links').update({ status: 'needs_review', reason: 'Gmail reports this previously linked thread is no longer available. Existing CRM history remains; no new content was imported.' })
      .eq('connection_id', connection.id).eq('gmail_thread_id', id);
    if (unavailable.error) throw databaseError(unavailable.error);
    console.warn('[gmail-sync] Gmail thread no longer available; no new content imported.');
    return false;
  }
  const headers = gmailMessages(raw);
  if (!headers.some((item) => ['From', 'To', 'Cc', 'Bcc'].some((field) => gmailAddresses(gmailHeader(item, field)).some((email) => known.has(email))))) return false;
  let contact = matchGmailThread(headers, connection.email, known);
  const messages = contact ? gmailMessages(await gmailRequest(db, connection.id, `/threads/${encodeURIComponent(id)}?format=full`)) : [];
  if (contact) contact = matchGmailThread(messages, connection.email, known);
  await renewSync(db, connection);
  const link = await db.from('gmail_thread_links').upsert({
    connection_id: connection.id, gmail_thread_id: id, client_id: contact?.clientId ?? null, lead_id: contact?.leadId ?? null,
    status: contact ? 'linked' : 'needs_review', reason: contact ? null : 'Ambiguous or mixed participants. Review this thread in Gmail; no content was imported.',
  });
  if (link.error) throw databaseError(link.error);
  if (!contact) return false;
  for (const message of messages) {
    const from = gmailAddresses(gmailHeader(message, 'From'))[0] ?? '';
    const outgoing = from === connection.email;
    const counterpart = outgoing
      ? gmailAddresses(gmailHeader(message, 'To')).find((email) => known.get(email)?.some((item) => contact.clientId ? item.clientId === contact.clientId : item.leadId === contact.leadId)) ?? contact.email
      : from;
    const content = gmailContent(message.payload);
    const { error } = await db.rpc('gmail_ingest_message', {
      p_connection_id: connection.id,
      p_historical: historical || Boolean(liveMessageIds && !liveMessageIds.has(message.id)),
      p_message: {
        lease_token: connection.sync_lease_token,
        participants: [...new Set(messages.flatMap((item) => ['From', 'To', 'Cc', 'Bcc'].flatMap((field) => gmailAddresses(gmailHeader(item, field)))).filter((email) => email !== connection.email))],
        id: message.id, thread_id: id, counterpart, direction: outgoing ? 'outbound' : 'inbound',
        from, to: outgoing ? counterpart : connection.email, subject: gmailHeader(message, 'Subject'),
        body: content.text, sent_at: new Date(Number(message.internalDate)).toISOString(),
        rfc_message_id: gmailHeader(message, 'Message-ID'), in_reply_to: gmailHeader(message, 'In-Reply-To'),
        references: gmailHeader(message, 'References'), attachments: content.attachments,
      },
    });
    if (error) throw databaseError(error);
  }
  return true;
}

export async function syncGmailConnection(db: SupabaseClient, connectionId: string): Promise<{ processed: number }> {
  const claimed = await db.rpc('claim_gmail_sync', { p_connection_id: connectionId });
  if (claimed.error) throw databaseError(claimed.error);
  const connection = (claimed.data as SyncConnection[] | null)?.[0];
  if (!connection) return { processed: 0 };
  let history = connection.history_id;
  let complete = connection.bootstrap_complete;
  let processed = 0;
  let failure: string | null = null;
  let moreWork = true;
  const started = Date.now();
  const withinBudget = (): boolean => Date.now() - started < 45000;
  const withinBackfillBudget = (): boolean => Date.now() - started < 18000;
  try {
    const known = await contacts(db);
    // Establish the live cutover before any potentially long historical backfill.
    if (!history) {
      const profile = await gmailRequest(db, connection.id, '/profile');
      if (!isRecord(profile) || typeof profile.historyId !== 'string') throw new WorkspaceError('Gmail history identity is missing.', 503);
      history = profile.historyId;
    }
    if (!connection.watch_renewed_at || Date.parse(connection.watch_renewed_at) < Date.now() - 86400000) {
      const topic = process.env.GMAIL_PUBSUB_TOPIC;
      if (!topic) throw new WorkspaceError('Gmail Pub/Sub topic is not configured.', 503);
      const watch = await gmailRequest(db, connection.id, '/watch', { method: 'POST', body: JSON.stringify({ topicName: topic }) });
      if (!isRecord(watch) || typeof watch.expiration !== 'string') throw new WorkspaceError('Gmail watch registration did not return an expiration.', 503);
      const saved = await db.from('gmail_connections').update({ watch_renewed_at: new Date().toISOString(), watch_expires_at: new Date(Number(watch.expiration)).toISOString() })
        .eq('id', connection.id).eq('sync_lease_token', connection.sync_lease_token);
      if (saved.error) throw databaseError(saved.error);
    }
    // Targeted completed pages remain checkpoints; newly recorded contact emails create new work.
    complete = true;
    for (const email of known.keys()) {
      const query = `in:anywhere -in:trash -in:spam {from:${JSON.stringify(email)} to:${JSON.stringify(email)}}`;
      const progress = await db.from('gmail_sync_pages').select('page_token,completed,processed_thread_ids').eq('connection_id', connection.id).eq('kind', 'contact').eq('query', query).maybeSingle();
      if (progress.error) throw databaseError(progress.error);
      if (progress.data?.completed) continue;
      if (!withinBackfillBudget()) { complete = false; break; }
      let token: string | undefined = progress.data?.page_token ?? undefined;
      let done = new Set<string>(progress.data?.processed_thread_ids ?? []);
      do {
        const params = new URLSearchParams({ q: query, maxResults: '5', ...(token ? { pageToken: token } : {}) });
        const page = await gmailRequest(db, connection.id, `/threads?${params}`);
        if (!isRecord(page)) throw new WorkspaceError('Gmail returned an invalid thread list.', 503);
        for (const thread of Array.isArray(page.threads) ? page.threads : []) {
          if (!withinBackfillBudget()) { complete = false; break; }
          if (!isRecord(thread) || typeof thread.id !== 'string') throw new WorkspaceError('Gmail returned an invalid thread identity.', 503);
          if (done.has(thread.id)) continue;
          if (await importThread(db, connection, thread.id, known, true)) processed += 1;
          done.add(thread.id);
          await renewSync(db, connection);
          const saved = await db.from('gmail_sync_pages').upsert({ connection_id: connection.id, kind: 'contact', query, page_token: token ?? null, processed_thread_ids: [...done], completed: false });
          if (saved.error) throw databaseError(saved.error);
        }
        if (!complete) break;
        await renewSync(db, connection);
        token = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
        const checkpoint = await db.from('gmail_sync_pages').upsert({
          connection_id: connection.id, kind: 'contact', query, page_token: token ?? null, processed_thread_ids: [], completed: !token,
        });
        if (checkpoint.error) throw databaseError(checkpoint.error);
        done = new Set();
        if (!withinBackfillBudget() && token) { complete = false; break; }
      } while (token);
      if (!complete) break;
    }
    // Replay live changes from the pre-backfill cursor, never from watch's newer cursor.
    if (!withinBudget()) return { processed };
    const historyProgress = await db.from('gmail_sync_pages').select('page_token,processed_thread_ids').eq('connection_id', connection.id).eq('kind', 'history').eq('query', history).maybeSingle();
    if (historyProgress.error) throw databaseError(historyProgress.error);
    let token: string | undefined = historyProgress.data?.page_token ?? undefined;
    let done = new Set<string>(historyProgress.data?.processed_thread_ids ?? []);
    let latest = history;
    do {
      if (!withinBudget()) return { processed };
      const params = new URLSearchParams({ startHistoryId: history, maxResults: '5', historyTypes: 'messageAdded', ...(token ? { pageToken: token } : {}) });
      let page: unknown;
      try { page = await gmailRequest(db, connection.id, `/history?${params}`); }
      catch (error) {
        if (!(error instanceof GmailHttpError) || error.providerStatus !== 404) throw error;
        const reset = await db.from('gmail_sync_pages').delete().eq('connection_id', connection.id);
        if (reset.error) throw databaseError(reset.error);
        history = null; complete = false;
        return { processed };
      }
      if (!isRecord(page)) throw new WorkspaceError('Gmail history response is invalid.', 503);
      const threads = new Map<string, Set<string>>();
      for (const event of Array.isArray(page.history) ? page.history : []) {
        if (!isRecord(event) || !Array.isArray(event.messagesAdded)) continue;
        for (const added of event.messagesAdded) {
          if (!isRecord(added) || !isRecord(added.message) || typeof added.message.threadId !== 'string' || typeof added.message.id !== 'string') continue;
          const ids = threads.get(added.message.threadId) ?? new Set<string>();
          ids.add(added.message.id); threads.set(added.message.threadId, ids);
        }
      }
      for (const [thread, ids] of threads) {
        if (!withinBudget()) return { processed };
        const workKey = `${thread}:${Array.from(ids).sort().join(',')}`;
        if (done.has(workKey)) continue;
        if (await importThread(db, connection, thread, known, false, ids)) processed += 1;
        done.add(workKey);
        await renewSync(db, connection);
        const saved = await db.from('gmail_sync_pages').upsert({ connection_id: connection.id, kind: 'history', query: history, page_token: token ?? null, processed_thread_ids: [...done], completed: false });
        if (saved.error) throw databaseError(saved.error);
      }
      if (typeof page.historyId === 'string') latest = page.historyId;
      token = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
      await renewSync(db, connection);
      const checkpoint = await db.from('gmail_sync_pages').upsert({ connection_id: connection.id, kind: 'history', query: history, page_token: token ?? null, processed_thread_ids: [], completed: !token });
      if (checkpoint.error) throw databaseError(checkpoint.error);
      done = new Set();
    } while (token);
    // Keep replaying the original live cutover until every backfill page is complete.
    if (complete) history = latest;
    moreWork = !complete;
  } catch (error) {
    complete = connection.bootstrap_complete;
    failure = error instanceof WorkspaceError ? error.message : 'Gmail synchronization failed. Check connection setup and retry.';
    throw error;
  } finally {
    const finished = await db.rpc('finish_gmail_sync', {
      p_connection_id: connection.id, p_lease_token: connection.sync_lease_token,
      p_history_id: history, p_bootstrap_complete: complete, p_error: failure,
      p_more_work: moreWork,
    });
    if (finished.error) throw databaseError(finished.error);
    if (finished.data !== true) throw new WorkspaceError('Gmail sync lease expired. Checkpoint was not saved; retry safely.', 409);
  }
  return { processed };
}
