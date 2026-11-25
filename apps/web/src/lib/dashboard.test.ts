import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/dashboard/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const actor = 'cf98e001-b31a-4fbc-9eba-31ac9215d439';
const request = (section = 'overview') => new NextRequest(`https://crm.example.invalid/api/dashboard?section=${section}`);

beforeEach(() => vi.clearAllMocks());

it('returns no customer data or database queries for a marketing-only member', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'key', { global: { fetch: fetcher } }));
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: { id: actor, aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '' }, teamAccess: { mode: 'restricted', grants: { 'social.view': 'agency' } } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ leads: null, policies: null });
  expect(await (await GET(request('tasks'))).json()).toEqual({ tasks: null });
  expect(await (await GET(request('renewals'))).json()).toEqual({ renewals: null });
  expect(fetcher).not.toHaveBeenCalled();
});

it('scopes lead counts and personal task metrics to the signed-in member', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/leads')) {
      expect(url.searchParams.get('agent_user_id')).toBe(`eq.${actor}`);
      return new Response(null, { status: 200, headers: { 'content-range': '0-0/1' } });
    }
    if (url.pathname.endsWith('/active_workspace_tasks')) {
      expect(url.searchParams.get('created_by_user_id')).toBe(`eq.${actor}`);
      expect(url.searchParams.get('related_id')).toBe('is.null');
      expect(url.searchParams.get('account_id')).toBe('is.null');
      return Response.json([{ status: 'open', due_date: null, completed_at: null }]);
    }
    throw new Error(`Unexpected dashboard query: ${url.pathname}`);
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'key', { global: { fetch: fetcher } }));
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: { id: actor, aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '' }, teamAccess: { mode: 'restricted', grants: {
      'leads.view': 'assigned', 'tasks.view': 'self',
    } } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ leads: { active: 1, conversion: 1, scope: 'assigned' }, policies: null });
  expect(await (await GET(request('tasks'))).json()).toEqual({
    tasks: { on_time: 0, overdue: 0, open: 1, completed: 0, unclassified: 0 },
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('uses the database-assigned task scope for dashboard metrics', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(new URL(String(input)).pathname).toBe('/rest/v1/rpc/team_assigned_workspace_tasks');
    expect(JSON.parse(String(init?.body))).toEqual({ p_actor: actor, p_include_archived: false });
    return Response.json([{ status: 'open', due_date: null, completed_at: null }]);
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'key', { global: { fetch: fetcher } }));
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: { id: actor, aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '' }, teamAccess: { mode: 'restricted', grants: { 'tasks.view': 'assigned' } } });
  const response = await GET(request('tasks'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ tasks: { on_time: 0, overdue: 0, open: 1, completed: 0, unclassified: 0 } });
});

it('returns only assigned policy metrics and renewals for mixed agency and assigned grants', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/team_assigned_premium_summary')) {
      const body = JSON.parse(String(init?.body)) as { p_actor: string; p_first_month: string };
      expect(body.p_actor).toBe(actor);
      const first = new Date(`${body.p_first_month}T00:00:00Z`);
      const months = Array.from({ length: 12 }, (_, index) => {
        const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
        return { month: month.toISOString().slice(0, 7), premium: index === 0 ? 100 : 0 };
      });
      return Response.json({ total: 100, months });
    }
    if (url.pathname.endsWith('/team_assigned_dashboard_renewals') || url.pathname.endsWith('/team_assigned_dashboard_claims')) {
      if (init?.method === 'HEAD') {
        expect(url.searchParams.get('p_actor')).toBe(actor);
        return new Response(null, { status: 200, headers: { 'content-range': '0-0/1' } });
      }
      expect(JSON.parse(String(init?.body))).toEqual({ p_actor: actor });
      return Response.json(url.searchParams.get('renewal_date') === 'is.null' ? [] : [{
        id: 'renewal', insured_name: 'Assigned client', carrier: 'Carrier', line_of_business: 'Auto',
        premium: 100, renewal_date: '2026-01-02', expiration_date: null,
      }]);
    }
    throw new Error(`Unexpected dashboard query: ${url.pathname}`);
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'key', { global: { fetch: fetcher } }));
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: { id: actor, aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '' }, teamAccess: { mode: 'restricted', grants: {
      'accounts.view': 'assigned', 'policies.view': 'agency',
    } } });
  const data = await (await GET(request())).json();
  expect(data.policies).toMatchObject({ scope: 'assigned', total_written_premium: 100, renewals_30_days: 1, open_claims: 1 });
  expect(await (await GET(request('renewals'))).json()).toMatchObject({ renewals: [{ insured_name: 'Assigned client' }] });
});
