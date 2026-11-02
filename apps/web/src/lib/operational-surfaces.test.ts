import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getApiSession, requireApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET as inbox } from '../app/api/communication/inbox/route';
import { GET as thread } from '../app/api/communication-log/route';
import { PATCH as assign } from '../app/api/workday/route';
import { trackedAutomation } from './automation-health';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), requireApiSession: vi.fn(), apiActorName: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./outreach-engine', () => ({ handleInboundReply: vi.fn() }));
const account = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const user: User = { id: account, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const requests: Array<{ url: URL; body: Record<string, unknown> | null; method: string }> = [];
let failJob = false;
let failState = false;
beforeEach(() => {
  failJob = false; failState = false; requests.length = 0;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(requireApiSession).mockResolvedValue(null);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, body, method });
    if (url.pathname.endsWith('automation_runs')) {
      if (failJob && method === 'POST') return Response.json({ code: '23505', message: 'A run is already active.' }, { status: 409 });
      return Response.json({ id: account, job: 'test-job', started_at: new Date().toISOString(), ...body });
    }
    if (url.pathname.endsWith('update_workday_source')) return failState
      ? Response.json({ code: '40001', message: 'Another agent changed this work.' }, { status: 409 }) : Response.json({ work_id: body?.p_id });
    if (url.pathname.endsWith('conversation_inbox')) return Response.json([{ key: `client:${account}`, email: 'account@example.invalid' }], { headers: { 'Content-Range': '25-49/1200' } });
    return Response.json([{ id: account, conversation_key: `client:${account}` }], { headers: { 'Content-Range': '200-200/201' } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
it('queries paged database conversation summaries instead of sampling the latest logs', async () => {
  const result = await inbox(new NextRequest('http://localhost/api/communication/inbox?page=1&q=person'));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ total: 1200, page: 1, conversations: [{ href: `/clients/${account}?tab=communication` }] });
  expect(requests[0].url.pathname).toContain('conversation_inbox');
  expect(requests[0].url.searchParams.get('offset')).toBe('25');
  expect(requests[0].url.searchParams.get('or')).toContain('name.ilike.%person%');
});
it('uses canonical account identity and returns explicit next-page metadata', async () => {
  const result = await thread(new NextRequest(`http://localhost/api/communication-log?client_id=${account}&offset=200&limit=1`));
  expect(result.status).toBe(200);
  expect(result.headers.get('X-Total-Count')).toBe('201');
  expect(result.headers.get('X-Next-Offset')).toBe('');
  expect(requests[0].url.pathname).toContain('canonical_communications');
  expect(requests[0].url.searchParams.get('conversation_key')).toBe(`eq.client:${account}`);
  expect(requests[0].url.searchParams.get('offset')).toBe('200');
});
it('validates source-only assignment and exposes concurrent edits', async () => {
  const request = (body: object): NextRequest => new NextRequest('http://localhost/api/workday', { method: 'PATCH', body: JSON.stringify(body) });
  expect((await assign(request({ id: 'source', expected_updated_at: null, assignee: 'Agent' }))).status).toBe(200);
  expect(requests[0].body).toMatchObject({ p_id: 'source', p_version: null, p_changes: { assignee: 'Agent' } });
  expect((await assign(request({ id: 'source', expected_updated_at: null, due_date: 'yesterday' }))).status).toBe(400);
  failState = true;
  expect((await assign(request({ id: 'source', expected_updated_at: null, assignee: 'Another agent' }))).status).toBe(409);
});
it('persists real job failures and never executes when the start cannot be recorded', async () => {
  const db = getSupabaseServerClient()!;
  const action = vi.fn(async () => { throw new Error('Provider failed'); });
  expect(await trackedAutomation(db, 'test-job', action)).toMatchObject({ status: 'failed', error: 'Provider failed' });
  expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({ status: 'failed', error: 'Provider failed' });
  failJob = true;
  action.mockClear();
  await expect(trackedAutomation(db, 'test-job', action)).rejects.toThrow('Could not record');
  expect(action).not.toHaveBeenCalled();
});
