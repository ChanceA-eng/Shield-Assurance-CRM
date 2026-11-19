import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { gmailRequest, GmailHttpError } from './gmail-provider';
import { syncGmailConnection } from './gmail-sync';

vi.mock('./gmail-provider', async (original) => ({ ...await original<typeof import('./gmail-provider')>(), gmailRequest: vi.fn() }));
interface Call { name: string; method: string; body: Record<string, unknown> | null; url: URL }
let calls: Call[];
let db: SupabaseClient;
let historyExpired: boolean;
let leaseValid: boolean;
let pages: Map<string, Record<string, unknown>>;
const cursor = '90071992547409999999';
const message = (from = 'client@example.invalid') => ({ id: 'm1', threadId: 't1', internalDate: '1780000000000',
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: 'agent@example.invalid' }, { name: 'Message-ID', value: '<unique@example.invalid>' }],
    body: { data: Buffer.from('Please call me.').toString('base64url') } } });
beforeEach(() => {
  vi.clearAllMocks(); calls = []; historyExpired = false; leaseValid = true; pages = new Map();
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/qa/topics/gmail');
  db = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
      const parsed = new URL(String(url));
      const call: Call = { name: parsed.pathname.split('/').pop() ?? '', method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, url: parsed };
      calls.push(call);
      if (call.name === 'claim_gmail_sync') return Response.json([{ id: 'c1', user_id: 'agent1', email: 'agent@example.invalid', status: 'connected', sync_lease_token: 'lease1', history_id: null, bootstrap_complete: false, watch_renewed_at: null }]);
      if (call.name === 'renew_gmail_sync') return Response.json(leaseValid);
      if (call.name === 'finish_gmail_sync') return Response.json(true);
      if (call.name === 'clients') return Response.json([{ id: 'client1', email: 'client@example.invalid' }]);
      if (call.name === 'leads') return Response.json([]);
      if (call.name === 'gmail_sync_pages') {
        if (call.method === 'POST' && call.body) pages.set(`${call.body.kind}:${call.body.query}`, call.body);
        if (call.method === 'GET') return Response.json(pages.get(`${call.url.searchParams.get('kind')?.slice(3)}:${call.url.searchParams.get('query')?.slice(3)}`) ?? null);
      }
      return Response.json(null);
    } },
  });
  vi.mocked(gmailRequest).mockImplementation(async (_db, _id, path) => {
    const url = new URL(`https://gmail.test${path}`);
    if (url.pathname === '/profile') return { historyId: cursor };
    if (url.pathname === '/watch') return { expiration: String(Date.now() + 86400000) };
    if (url.pathname === '/threads') return url.searchParams.has('pageToken') ? { threads: [] } : { threads: [{ id: 't1' }], nextPageToken: 'contact-page-2' };
    if (url.pathname === '/threads/t1') return { messages: [message()] };
    if (url.pathname === '/threads/unrelated') return { messages: [message('unknown@example.invalid')] };
    if (url.pathname === '/history') {
      if (historyExpired) throw new GmailHttpError(404);
      return url.searchParams.has('pageToken') ? { historyId: '90071992547410000003', history: [] } : {
        historyId: '90071992547410000002', nextPageToken: 'history-page-2', history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }, { message: { id: 'unrelated', threadId: 'unrelated' } }] }],
      };
    }
    throw new Error(`Unexpected provider path ${path}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('paginates complete contact threads and history without converting large history IDs to numbers', async () => {
  expect((await syncGmailConnection(db, 'c1')).processed).toBe(2);
  const providerCalls = vi.mocked(gmailRequest).mock.calls.map((call) => call[2]);
  expect(providerCalls.some((path) => path.includes('pageToken=contact-page-2'))).toBe(true);
  expect(providerCalls.some((path) => path.includes('pageToken=history-page-2'))).toBe(true);
  expect(providerCalls.filter((path) => path.startsWith('/history')).every((path) => path.includes(`startHistoryId=${cursor}`))).toBe(true);
  expect(calls.at(-1)?.body).toMatchObject({ p_history_id: '90071992547410000003', p_bootstrap_complete: true, p_error: null });
});
it('promotes messages encountered by backfill to live ingestion when history replay sees them', async () => {
  await syncGmailConnection(db, 'c1');
  const ingested = calls.filter((call) => call.name === 'gmail_ingest_message');
  expect(ingested.map((call) => call.body?.p_historical)).toEqual([true, false]);
  expect(ingested[0]?.body?.p_message).toMatchObject({ id: 'm1', lease_token: 'lease1', participants: ['client@example.invalid'] });
});
it('never fetches or retains full bodies from unrelated history notifications', async () => {
  await syncGmailConnection(db, 'c1');
  expect(vi.mocked(gmailRequest).mock.calls.some((call) => call[2] === '/threads/unrelated?format=full')).toBe(false);
  expect(calls.filter((call) => call.name === 'gmail_ingest_message').some((call) => JSON.stringify(call.body).includes('unknown@example.invalid'))).toBe(false);
});
it('resets expired history to a resumable contact-scoped backfill, not a new success cursor', async () => {
  historyExpired = true;
  await syncGmailConnection(db, 'c1');
  expect(calls.some((call) => call.name === 'gmail_sync_pages' && call.method === 'DELETE')).toBe(true);
  expect(calls.at(-1)?.body).toMatchObject({ p_history_id: null, p_bootstrap_complete: false });
});
it('stops importing immediately when lease renewal fails', async () => {
  leaseValid = false;
  await expect(syncGmailConnection(db, 'c1')).rejects.toThrow('lease expired');
  expect(calls.some((call) => call.name === 'gmail_ingest_message')).toBe(false);
  expect(calls.at(-1)?.body?.p_error).toContain('lease expired');
});
it('checkpoints partial pages per thread and reserves work for live history during a long backfill', async () => {
  const start = Date.now(); let clock = start;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const provider = vi.mocked(gmailRequest).getMockImplementation();
  vi.mocked(gmailRequest).mockImplementation(async (client, id, path, init) => {
    if (path.startsWith('/threads?') && !path.includes('pageToken')) return { threads: [{ id: 't1' }, { id: 't2' }] };
    if (path === '/threads/t1?format=full') clock = start + 20000;
    if (path.startsWith('/threads/t2?')) return { messages: [{ ...message(), id: 'm2', threadId: 't2' }] };
    return provider?.(client, id, path, init);
  });
  await syncGmailConnection(db, 'c1');
  expect(calls.some((call) => call.name === 'gmail_sync_pages' && call.body?.kind === 'contact' && JSON.stringify(call.body.processed_thread_ids) === '["t1"]')).toBe(true);
  expect(calls.filter((call) => call.name === 'gmail_ingest_message').some((call) => call.body?.p_historical === false)).toBe(true);
  expect(calls.at(-1)?.body).toMatchObject({ p_history_id: cursor, p_bootstrap_complete: false, p_more_work: true });
  clock = start;
  calls = []; vi.mocked(gmailRequest).mockClear();
  await syncGmailConnection(db, 'c1');
  const historical = calls.filter((call) => call.name === 'gmail_ingest_message' && call.body?.p_historical === true);
  expect(historical.map((call) => (call.body?.p_message as { id: string }).id)).toEqual(['m2']);
  expect(calls.at(-1)?.body).toMatchObject({ p_bootstrap_complete: true, p_more_work: false });
});
