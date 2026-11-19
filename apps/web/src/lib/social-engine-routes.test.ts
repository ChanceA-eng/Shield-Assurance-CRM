import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../app/api/social-marketing/engine/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const actor = '04865539-8320-4031-93de-8047f715f748';
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const command = { id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d', action: 'approve', expected_version: 2 };
let calls: Array<{ url: string; body: unknown }>;
let response: unknown;
let status: number;
const request = (body: unknown): NextRequest => new NextRequest('https://crm.invalid/api/social-marketing/engine', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  calls = []; response = { state: 'approved' }; status = 200;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
    } }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});
describe('Social engine API', () => {
  it('requires authentication for both reads and writes', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await POST(request(command))).status).toBe(401);
    expect((await GET(new NextRequest('https://crm.invalid/api/social-marketing/engine'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('passes only verified actor and validated command to RPC', async () => {
    expect((await POST(request(command))).status).toBe(200);
    expect(calls[0].body).toEqual({ p_actor: actor, p_command: command });
    expect(calls[0].url).toContain('/rpc/command_social_engine');
  });
  it('prepares real targets through a destination-aware server RPC', async () => {
    const value = { action: 'prepare_publish', id: command.id, post_id: command.id, revision: 3, connection_id: command.id };
    expect((await POST(request(value))).status).toBe(200);
    expect(calls[0].url).toContain('/rpc/prepare_social_publish_intent');
    expect(calls[0].body).toEqual({ p_actor: actor, p_id: value.id, p_post_id: value.post_id, p_revision: 3, p_connection_id: value.connection_id });
  });
  it('resolves uncertain real results only through the dedicated guarded RPC', async () => {
    const value = { action: 'resolve_publish', id: command.id, expected_version: 4, resolution: 'published', remote_id: '123_456' };
    expect((await POST(request(value))).status).toBe(200);
    expect(calls[0].url).toContain('/rpc/resolve_social_publish_intent');
    expect(calls[0].body).toEqual({ p_actor: actor, p_id: value.id, p_expected_version: 4,
      p_resolution: 'published', p_remote_id: '123_456', p_permalink: null });
  });
  it('rejects actor, workspace, lease, or destination spoofing before RPC', async () => {
    for (const field of ['p_actor','workspace_id','lease_id','destination']) {
      expect((await POST(request({ ...command, [field]: actor }))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
  it.each([['42501',403],['PT409',409],['22023',400],['P0002',404]])('surfaces database errors %s', async (code, expected) => {
    response = { code, message: 'Execution is not allowed. Reload.' }; status = expected;
    expect((await POST(request(command))).status).toBe(expected);
  });
  it('gives actionable missing-schema guidance', async () => {
    response = { code: 'PGRST202', message: 'Missing command_social_engine' }; status = 404;
    const result = await POST(request(command));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ message: expect.stringContaining('20261105220000') });
  });
  it('does not claim success if database confirmation is absent', async () => {
    response = null;
    expect((await POST(request(command))).status).toBe(503);
  });
  it('lists actor-scoped status without caching', async () => {
    response = { intents: [], connections: [], paused: true, worker_seen_at: null, worker_test_enabled: false, worker_real_enabled: false, can_manage: false };
    const result = await GET(new NextRequest('https://crm.invalid/api/social-marketing/engine'));
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(calls[0].body).toEqual({ p_actor: actor });
  });
});
