import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET, POST } from '../app/api/intelligence/questionnaire/[token]/route';
import { POST as SHARE } from '../app/api/intelligence/questionnaire/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c', token = 'a'.repeat(43);
const user: User = { id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const context = { params: Promise.resolve({ token }) };
let result: unknown, databaseCode: string | null;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; databaseCode = null;
  result = { questions: 'Which business lines should we review?', submitted: false, expires_at: '2099-01-01', account_name: 'Must not be exposed', contact: 'Must not be exposed' };
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ name: new URL(String(input)).pathname.split('/').pop() ?? '', args: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return databaseCode ? Response.json({ code: databaseCode, message: 'Link no longer available' }, { status: 400 }) : Response.json(result);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'synthetic-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
});
const request = (body?: object, origin = 'http://localhost') => new NextRequest(`http://localhost/api/intelligence/questionnaire/${token}`, body ? {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
} : undefined);

it('uses only token hashes and whitelists public questions without disclosing account information', async () => {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ questions: 'Which business lines should we review?', submitted: false, expires_at: '2099-01-01' });
  expect(calls[0]).toEqual({ name: 'public_opportunity_questionnaire', args: {
    p_hash: createHash('sha256').update(token).digest('hex'), p_response: null, p_consent: false,
  } });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(getApiSession).not.toHaveBeenCalled();
});
it('rejects malformed tokens before touching the database', async () => {
  expect((await GET(request(), { params: Promise.resolve({ token: 'invalid' }) })).status).toBe(404);
  expect(calls).toHaveLength(0);
});
it.each([{ response: '', consent: true }, { response: 'Business answer', consent: false }, { response: 'x'.repeat(3001), consent: true }])('requires bounded business responses and consent: %j', async (body) => {
  expect((await POST(request(body), context)).status).toBe(400);
  expect(calls).toHaveLength(0);
});
it('rejects cross-origin submissions before invoking the response RPC', async () => {
  expect((await POST(request({ response: 'Business answer', consent: true }, 'https://other.example.test'), context)).status).toBe(403);
  expect(calls).toHaveLength(0);
});
it('submits exactly once through the immutable-response RPC and never forwards internal response fields', async () => {
  result = { submitted: true, account_name: 'Must not be exposed' };
  const response = await POST(request({ response: 'Business answer', consent: true }), context);
  expect(await response.json()).toEqual({ submitted: true });
  expect(calls[0].args).toMatchObject({ p_response: 'Business answer', p_consent: true });
});
it.each([['P0002', 404], ['42501', 403], ['PT409', 409]] as const)('reports unavailable, revoked-scope and changed-response errors: %s', async (code, status) => {
  databaseCode = code;
  expect((await GET(request(), context)).status).toBe(status);
});
it('fails explicitly when the stored questionnaire shape is invalid', async () => {
  result = { submitted: false, questions: 'Business question', expires_at: 'not-a-date' };
  expect((await GET(request(), context)).status).toBe(503);
});
it('requires agent authentication to share and returns only a generated link and verified expiry', async () => {
  result = { expires_at: '2099-01-01', internal: 'Not public' };
  const body = { type: 'lead', id, request_id: id, revoke: false };
  const response = await SHARE(request(body));
  const shared = await response.json() as { path: string; expires_at: string };
  expect(Object.keys(shared).sort()).toEqual(['expires_at', 'path']);
  const generated = shared.path.split('/').pop() ?? '';
  expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(calls[0].args).toMatchObject({ p_actor: id, p_hash: createHash('sha256').update(generated).digest('hex') });
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Sign in' }, { status: 401 }) });
  expect((await SHARE(request(body))).status).toBe(401);
});
