import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../app/api/shell/route';
import { requireApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { authenticatesInReadHandler } from './route-authentication';
import { middleware } from '../middleware';

vi.mock('./api-auth', () => ({ requireApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => { throw new Error('Duplicate auth lookup'); }) }));
const summary = { overdueCount: 2, dueTodayCount: 5, unreadCount: 150, notifications: [],
  unreadMessages: { total: 3, byClient: {}, byLead: {} } };
let calls: URL[];
let result: unknown;
let status: number;
beforeEach(() => {
  calls = []; result = summary; status = 200;
  vi.mocked(requireApiSession).mockResolvedValue(null);
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (input) => {
      calls.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
      return Response.json(result, { status });
    } }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});
describe('loading performance contracts', () => {
  it('loads all badges and notification data in one database request and never caches it publicly', async () => {
    const response = await GET(new NextRequest('http://localhost/api/shell'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/rest/v1/rpc/crm_shell_summary');
  });
  it('does not trust client cookies or skip authorization when middleware delegates a read', async () => {
    const request = new NextRequest('http://localhost/api/shell', { headers: { Cookie: 'untrusted=1' } });
    expect((await middleware(request)).headers.get('x-middleware-next')).toBe('1');
    vi.mocked(requireApiSession).mockResolvedValue(NextResponse.json({ message: 'Unauthorized' }, { status: 401 }));
    expect((await GET(request)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('never bypasses middleware for writes or handlers without their own session guard', () => {
    expect(authenticatesInReadHandler('/api/shell', 'GET')).toBe(true);
    expect(authenticatesInReadHandler('/api/tasks', 'PATCH')).toBe(false);
    expect(authenticatesInReadHandler('/api/leads', 'POST')).toBe(false);
    expect(authenticatesInReadHandler('/api/unknown', 'GET')).toBe(false);
    expect(authenticatesInReadHandler('/api/reports/premium', 'GET')).toBe(false);
    expect(authenticatesInReadHandler('/clients', 'GET')).toBe(false);
  });
  it('surfaces database failure rather than clearing existing notification badges', async () => {
    result = { message: 'Summary unavailable', code: 'XX000' }; status = 500;
    expect((await GET(new NextRequest('http://localhost/api/shell'))).status).toBe(500);
  });
  it.each([null, {}, { ...summary, unreadMessages: null }, { ...summary, dueTodayCount: null }])('rejects malformed summary %#', async (value) => {
    result = value;
    expect((await GET(new NextRequest('http://localhost/api/shell'))).status).toBe(500);
  });
});
