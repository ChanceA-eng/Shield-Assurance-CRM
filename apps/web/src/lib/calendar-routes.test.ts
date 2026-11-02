import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { getApiSession } from './api-auth';
import { GET, POST, PATCH } from '../app/api/events/route';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: () => 'QA agent' }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const user: User = { id, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-01T16:00:00Z' };
let calls: Array<{ url: URL; body: Record<string, unknown> | null }>;
let respond: (url: URL) => Response;
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (query = '', method = 'GET', body?: unknown): NextRequest => new NextRequest(`http://localhost/api/events${query}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
beforeEach(() => {
  calls = [];
  respond = () => json([]);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null });
    return respond(url);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
});

describe('calendar route contracts', () => {
  it('authenticates before database access', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await POST(request('', 'POST', {}))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('does not silently discard past appointments and paginates in the database', async () => {
    expect((await GET(request('?start=2025-01-01&end=2025-02-01&offset=200&status=completed'))).status).toBe(200);
    expect(calls[0].url.searchParams.get('event_date')).toBe('gte.2025-01-01');
    expect(calls[0].url.searchParams.getAll('event_date')).toContain('lt.2025-02-01');
    expect(calls[0].url.searchParams.get('offset')).toBe('200');
    expect(calls[0].url.searchParams.get('limit')).toBe('200');
    expect(calls[0].url.searchParams.get('status')).toBe('eq.completed');
    calls = [];
    await GET(request());
    expect(calls[0].url.searchParams.has('event_date')).toBe(false);
  });
  it('rejects invalid dates and status values before persistence', async () => {
    expect((await POST(request('', 'POST', { subject: 'Call', event_date: '2026-02-30' }))).status).toBe(400);
    expect((await PATCH(request('', 'PATCH', { id, status: 'bogus' }))).status).toBe(400);
    expect((await GET(request('?offset=-1'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('uses a single transactional RPC for creation and never logs a fake email', async () => {
    respond = () => json({ id, subject: 'Call' });
    expect((await POST(request('', 'POST', { id, subject: 'Call', event_date: '2026-11-02', event_time: '14:15', all_day: false }))).status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/save_calendar_event');
    expect(calls[0].body).toMatchObject({ p_id: id, p_create: true, p_actor: 'QA agent' });
  });
  it('surfaces transactional conflicts and missing schema instead of success', async () => {
    respond = () => json({ code: '23505', message: 'Event changed. Refresh before retrying.' }, 409);
    expect((await PATCH(request('', 'PATCH', { id, status: 'completed' }))).status).toBe(409);
    respond = () => json({ code: 'PGRST202', message: 'Could not find function public.save_calendar_event' }, 404);
    const response = await PATCH(request('', 'PATCH', { id, status: 'completed' }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toHaveProperty('message');
  });
});
