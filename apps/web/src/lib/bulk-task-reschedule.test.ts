import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PATCH } from '../app/api/tasks/bulk-reschedule/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: vi.fn(() => 'Authenticated agent') }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const version = '2026-11-02T18:00:00.123456Z';
const tasks = [{ id: first, expected_updated_at: version }, { id: second, expected_updated_at: version }];
let rpcCalls: Array<{ url: string; body: Record<string, unknown> }>;
let respond: () => Response;
const request = (body: unknown) => new NextRequest('https://crm.example.invalid/api/tasks/bulk-reschedule', { method: 'PATCH', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); rpcCalls = [];
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: first, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: version }, error: null });
  respond = () => Response.json([{ id: first }, { id: second }]);
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
      if (!init?.body) return Response.json([]);
      rpcCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> }); return respond();
    } },
  }));
});
describe('atomic bulk task rescheduling API', () => {
  it('accepts exactly 200 unique saved tasks', async () => {
    const batch = Array.from({ length: 200 }, () => ({ id: randomUUID(), expected_updated_at: version }));
    respond = () => Response.json(batch.map(({ id }) => ({ id })));
    const response = await PATCH(request({ tasks: batch, due_date: '2026-11-05T17:30:00Z' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 200 });
    expect(rpcCalls[0]?.body.p_tasks).toEqual(batch);
  });
  it('rejects duplicate UUIDs even when their casing differs', async () => {
    const id = 'abcdef00-0000-4000-8000-000000000001';
    const response = await PATCH(request({ tasks: [{ id, expected_updated_at: version }, { id: id.toUpperCase(), expected_updated_at: version }], due_date: '2026-11-05T17:30:00Z' }));
    expect(response.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
  it('uses one transactional RPC, server actor, exact saved versions and an absolute Arizona due time', async () => {
    const response = await PATCH(request({ tasks, due_date: '2026-11-05T10:30:00-07:00', actor: 'Spoofed actor', status: 'completed' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 2 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.url).toContain('/rpc/bulk_reschedule_tasks');
    expect(rpcCalls[0]?.body).toEqual({ p_tasks: tasks, p_due_date: '2026-11-05T17:30:00.000Z', p_actor: 'Authenticated agent' });
  });
  it.each([
    { tasks: [] }, { tasks: [...tasks, tasks[0]] }, { tasks: [{ id: first }] },
    { tasks: [{ id: 'invalid', expected_updated_at: version }] }, { tasks: Array.from({ length: 201 }, () => tasks[0]) },
    { tasks, due_date: '2026-11-05T10:30' }, { tasks, due_date: null },
  ])('rejects invalid selection or missing absolute date before mutation: %j', async (value) => {
    expect((await PATCH(request({ due_date: '2026-11-05T17:30:00Z', ...value }))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
  it('surfaces conflicts with no success-shaped partial result', async () => {
    respond = () => Response.json({ code: 'PT409', message: 'A selected task changed. No tasks were rescheduled.' }, { status: 409 });
    const response = await PATCH(request({ tasks, due_date: '2026-11-05T17:30:00Z' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: 'A selected task changed. No tasks were rescheduled.' });
  });
  it('requires an authenticated agency session before any database access', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await PATCH(request({ tasks, due_date: '2026-11-05T17:30:00Z' }))).status).toBe(401);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });
});
