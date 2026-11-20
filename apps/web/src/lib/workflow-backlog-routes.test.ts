import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET, POST } from '../app/api/settings/automation/rules/backlog/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const id = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88a';
const user: User = { id, aud: 'authenticated', created_at: '2026-11-05T00:00:00Z', app_metadata: {}, user_metadata: {} };
const preview = { rule_id: id, rule_revision: 3, event: 'lead.created', action_type: 'create_task',
  eligible_count: 7, fingerprint: 'a'.repeat(32), batch_limit: 100, may_use_ai: false };
let role: string;
let rpcResponse: unknown;
let rpcError: Record<string, unknown> | null;
let calls: Array<{ path: string; method: string; body: unknown }>;
let teamAccess: { mode: 'restricted'; grants: Record<string, unknown> };

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' },
});
const db = (): ReturnType<typeof createClient> => createClient('https://db.example.invalid', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, method, body });
    if (url.pathname.endsWith('/agency_members')) return json({ user_id: id, role, active: true });
    if (url.pathname.endsWith('/preview_workflow_backlog') || url.pathname.endsWith('/apply_workflow_backlog')) {
      return json(rpcError ?? rpcResponse, rpcError ? 409 : 200);
    }
    return json({ message: 'Unexpected request' }, 400);
  } },
});

beforeEach(() => {
  vi.clearAllMocks(); role = 'owner'; rpcResponse = preview; rpcError = null; calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  teamAccess = { mode: 'restricted', grants: { 'automation.view': 'agency', 'automation.manage': 'agency' } };
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db());
});
afterEach(() => vi.restoreAllMocks());

const request = (url: string, method = 'GET', body?: unknown): NextRequest => new NextRequest(url, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const applyBody = { rule_id: id, expected_revision: 3, eligible_count: 7, fingerprint: 'a'.repeat(32), confirmed: true };

describe('custom rule backlog API', () => {
  it('previews one rule privately without queueing or executing work', async () => {
    const response = await GET(request(`http://localhost/api/settings/automation/rules/backlog?rule=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual(preview);
    expect(calls.map((call) => call.path)).toEqual(['/rest/v1/rpc/preview_workflow_backlog']);
  });
  it('blocks members without automation grants before exposing or applying a backlog', async () => {
    role = 'agent';
    teamAccess.grants = {};
    expect((await GET(request(`http://localhost/api/settings/automation/rules/backlog?rule=${id}`))).status).toBe(403);
    expect((await POST(request('http://localhost/api/settings/automation/rules/backlog', 'POST', applyBody))).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('requires explicit confirmation and a bounded exact preview fingerprint', async () => {
    expect((await POST(request('http://localhost/api/settings/automation/rules/backlog', 'POST',
      { ...applyBody, confirmed: false }))).status).toBe(400);
    expect((await POST(request('http://localhost/api/settings/automation/rules/backlog', 'POST',
      { ...applyBody, fingerprint: 'invalid' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('queues only the current previewed version/count/fingerprint through the guarded RPC', async () => {
    rpcResponse = { queued_count: 7, skipped_count: 0, remaining_count: 0, rule_revision: 3, preview_only: false };
    const response = await POST(request('http://localhost/api/settings/automation/rules/backlog', 'POST', applyBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rpcResponse);
    expect(calls[0]).toMatchObject({ path: '/rest/v1/rpc/apply_workflow_backlog', method: 'POST',
      body: { p_actor: id, p_rule: id, p_expected_revision: 3, p_expected_count: 7, p_expected_fingerprint: 'a'.repeat(32) } });
  });
  it('retains the stale-preview conflict rather than treating it as success', async () => {
    rpcError = { code: 'PT409', message: 'Eligible records changed after the preview. Preview the backlog again.' };
    const response = await POST(request('http://localhost/api/settings/automation/rules/backlog', 'POST', applyBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('changed after the preview') });
  });
});
