import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, PATCH } from '../app/api/events/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { activeAgencyMember } from './agency-membership';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn() }));
vi.mock('./automation-settings', () => ({ getAgencyTimeZone: vi.fn().mockResolvedValue('America/Phoenix') }));

const user: User = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '' };
const event = '20000000-0000-4000-8000-000000000002';
const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: {
    mode: 'restricted', grants: { 'calendar.view': 'self', 'calendar.edit': 'self' },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
});

it('reads calendar rows through the record-scoped database function', async () => {
  fetcher.mockResolvedValue(Response.json([], { headers: { 'content-range': '*/0' } }));
  const response = await GET(new NextRequest('https://crm.example.invalid/api/events'));
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/rest/v1/rpc/team_calendar_events');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_actor: user.id });
});

it('denies an out-of-scope appointment before reading or mutating it', async () => {
  fetcher.mockResolvedValue(Response.json({ code: '42501', message: 'Forbidden' }, { status: 403 }));
  const response = await PATCH(new NextRequest('https://crm.example.invalid/api/events', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: event, subject: 'Changed' }),
  }));
  expect(response.status).toBe(403);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/rest/v1/rpc/assert_team_calendar_access');
});
