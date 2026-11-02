import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET } from '../app/api/workday/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const user: User = { id: '039d0052-4587-4bb9-9f0b-d5b92407f58c', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const calls: URL[] = [];
let missing = false;
beforeEach(() => {
  calls.length = 0; missing = false;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    return new Response(JSON.stringify(missing ? { code: 'PGRST205', message: 'Missing view' } : []), { status: missing ? 404 : 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/10000' } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
it('requires authentication and valid filters before database access', async () => {
  expect((await GET(new NextRequest('http://localhost/api/workday?page=-1'))).status).toBe(400);
  expect(calls).toHaveLength(0);
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
  expect((await GET(new NextRequest('http://localhost/api/workday'))).status).toBe(401);
  expect(calls).toHaveLength(0);
});
it('filters and paginates at the database, with an independent exact actionable count', async () => {
  const response = await GET(new NextRequest('http://localhost/api/workday?page=399&kind=reply&assignee=unassigned'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ page: 399, page_size: 25, total: 10000, actionable: 10000 });
  const rows = calls.find((url) => url.searchParams.has('offset'))!;
  expect(rows.searchParams.get('offset')).toBe('9975');
  expect(rows.searchParams.get('limit')).toBe('25');
  expect(rows.searchParams.get('kind')).toBe('eq.reply');
  expect(rows.searchParams.get('assignee')).toBe('is.null');
  expect(calls.some((url) => url.searchParams.get('actionable') === 'eq.true')).toBe(true);
  expect(calls.every((url) => url.searchParams.get('id') === 'not.like.intake:%')).toBe(true);
});
it('keeps task-backed work out of additional follow-ups before pagination and exact counts', async () => {
  const response = await GET(new NextRequest('http://localhost/api/workday?sources=true&page=1'));
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls.every((url) => url.searchParams.get('task_id') === 'is.null')).toBe(true);
  expect(calls.every((url) => url.searchParams.get('id') === 'not.like.intake:%')).toBe(true);
  expect(calls.find((url) => url.searchParams.has('offset'))?.searchParams.get('offset')).toBe('25');
});
it('rejects invalid source filters instead of returning task duplicates', async () => {
  expect((await GET(new NextRequest('http://localhost/api/workday?sources=invalid'))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
it('reports pending schema as an explicit setup error, not empty success', async () => {
  missing = true;
  const response = await GET(new NextRequest('http://localhost/api/workday'));
  expect(response.status).toBe(503);
  expect((await response.json()).message).toContain('migration has not been applied');
});
