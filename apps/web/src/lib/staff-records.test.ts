import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../app/api/staff-records/route';
import { GET as inbox, PATCH as review, POST as submit } from '../app/api/staff-policy-requests/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { permitsTeamRequest } from './team-request-access';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const user: User = { id: '168413e9-a6a4-4dff-a8bf-8f8df83dace6', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const fetcher = vi.fn<typeof fetch>();
const read = (params: string) => GET(new NextRequest(`http://localhost/api/staff-records?${params}`));
const grants = (values: Record<string, unknown>) => {
  const teamAccess = { mode: 'restricted' as const, grants: values };
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
  return teamAccess;
};

beforeEach(() => {
  fetcher.mockReset();
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
});

it('pages and searches only active leads in the permitted assignment scope', async () => {
  const access = grants({ 'leads.view': 'assigned' });
  fetcher.mockImplementation(async (input) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/rest/v1/leads');
    expect(url.searchParams.get('agent_user_id')).toBe(`eq.${user.id}`);
    expect(url.searchParams.get('archived_at')).toBe('is.null');
    expect(url.searchParams.get('full_name')).toBe('ilike.%Acme\\_%');
    expect(url.searchParams.get('offset')).toBe('25');
    expect(url.searchParams.get('limit')).toBe('26');
    return Response.json(Array.from({ length: 26 }, (_, index) => ({ id: index, full_name: 'Synthetic lead' })));
  });
  expect(permitsTeamRequest(access, '/leads', 'GET')).toBe(true);
  const response = await read('kind=leads&page=1&q=Acme_');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const data = await response.json();
  expect(data.rows).toHaveLength(25);
  expect(data.more).toBe(true);
});

it.each([
  { 'accounts.view': 'assigned', 'policies.view': 'agency' },
  { 'accounts.view': 'agency', 'policies.view': 'assigned' },
])('scopes policies through the authorized parent account with grants %j', async (values) => {
  const access = grants(values);
  fetcher.mockImplementation(async (input) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/rest/v1/policies');
    expect(url.searchParams.get('select')).toContain('account:clients!policies_client_id_fkey!inner(full_name,agent_user_id)');
    expect(url.searchParams.get('select')).not.toContain('issued_lead_id');
    expect(url.searchParams.get('account.agent_user_id')).toBe(`eq.${user.id}`);
    expect(url.searchParams.get('account.full_name')).toBe('ilike.%Acme%');
    return Response.json([{ id: 'synthetic-policy', account: { full_name: 'Acme' } }]);
  });
  expect(permitsTeamRequest(access, '/policies', 'GET')).toBe(true);
  expect((await (await read('kind=policies&q=Acme')).json()).rows).toHaveLength(1);
});

it('allows agency account browsing but exposes edit controls only for assigned rows with an assigned edit grant', async () => {
  grants({ 'accounts.view': 'agency', 'accounts.edit': 'assigned' });
  fetcher.mockImplementation(async (input) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/rest/v1/clients');
    expect(url.searchParams.has('agent_user_id')).toBe(false);
    return Response.json([{ id: 'mine', agent_user_id: user.id }, { id: 'other', agent_user_id: 'another-user' }]);
  });
  expect(await (await read('kind=accounts')).json()).toEqual({
    rows: [{ id: 'mine', canEdit: true }, { id: 'other', canEdit: false }], more: false,
  });
});

it('denies unauthorized record kinds and separate workflows before querying records', async () => {
  const access = grants({ 'accounts.view': 'agency', 'social.view': 'agency' });
  expect(permitsTeamRequest(access, '/clients', 'GET')).toBe(true);
  expect(permitsTeamRequest(access, '/communication/social', 'GET')).toBe(true);
  expect(permitsTeamRequest(access, '/leads', 'GET')).toBe(false);
  expect(permitsTeamRequest(access, '/api/leads', 'POST')).toBe(false);
  expect(permitsTeamRequest(access, '/api/clients', 'PATCH')).toBe(false);
  expect((await read('kind=leads')).status).toBe(403);
  grants({ 'policies.view': 'agency' });
  expect((await read('kind=policies')).status).toBe(403);
  grants({ 'social.view': 'agency' });
  expect((await read('kind=accounts')).status).toBe(403);
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({}, { status: 401 }) });
  expect((await read('kind=accounts')).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});

it('routes staff submissions to the scoped RPC without trusting the submitted actor or policy change fields', async () => {
  const access = grants({ 'accounts.view': 'assigned', 'policies.view': 'assigned', 'policies.edit': 'assigned' });
  const endpoint = 'http://localhost/api/staff-policy-requests';
  const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
  const request = (method: string, body: object) => new NextRequest(endpoint, { method, body: JSON.stringify(body) });
  expect(permitsTeamRequest(access, '/api/staff-policy-requests', 'POST')).toBe(true);
  expect((await inbox(new NextRequest(endpoint))).status).toBe(403);
  expect((await review(request('PATCH', { id, outcome: 'handled' }))).status).toBe(403);
  expect((await submit(request('POST', { policy_id: id, priority: 4, description: 'Request' }))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockImplementation(async (input, init) => {
    expect(new URL(String(input)).pathname).toBe('/rest/v1/rpc/submit_staff_policy_request');
    expect(JSON.parse(String(init?.body))).toEqual({ p_actor: user.id, p_policy: id, p_priority: 3, p_description: 'Request' });
    return Response.json(id);
  });
  const response = await submit(request('POST', { policy_id: id, priority: 3, description: ' Request ', p_actor: id, carrier: 'Other' }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id });
});
