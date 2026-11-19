import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../app/api/clients/[clientId]/route';
import { PATCH } from '../app/api/clients/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { permitsTeamRequest } from './team-request-access';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const client = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const user: User = { id: '168413e9-a6a4-4dff-a8bf-8f8df83dace6', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const context = { params: Promise.resolve({ clientId: client }) };
const detail = new NextRequest(`http://localhost/api/clients/${client}`);
const patch = (fields: Record<string, unknown>) => new NextRequest('http://localhost/api/clients', {
  method: 'PATCH', body: JSON.stringify({ id: client, ...fields }),
});
const assigned = { mode: 'restricted' as const, grants: { 'accounts.view': 'assigned', 'accounts.edit': 'agency' } };
const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
  fetcher.mockReset();
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: assigned });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
});

it('applies the narrower assignment scope to reads and updates before returning a record', async () => {
  fetcher.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.searchParams.get('id')).toBe(`eq.${client}`);
    expect(url.searchParams.get('agent_user_id')).toBe(`eq.${user.id}`);
    expect(url.searchParams.get('select')).not.toBe('*');
    return Response.json(init?.method === 'PATCH' ? { id: client, full_name: 'Synthetic account' } : []);
  });
  expect(permitsTeamRequest(assigned, detail.nextUrl.pathname, 'GET')).toBe(true);
  expect(permitsTeamRequest(assigned, '/api/clients', 'PATCH')).toBe(true);
  expect((await GET(detail, context)).status).toBe(404);
  const updated = await PATCH(patch({ full_name: 'Synthetic account' }));
  expect(updated.status).toBe(200);
  expect(await updated.json()).toEqual({ id: client, full_name: 'Synthetic account' });
});

it('rejects unauthorized updates before any database query', async () => {
  expect((await PATCH(patch({ agent_user_id: user.id }))).status).toBe(403);
  expect((await PATCH(patch({ email_consent: true }))).status).toBe(403);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null,
    teamAccess: { mode: 'restricted', grants: { 'accounts.view': 'agency' } } });
  expect((await PATCH(patch({ full_name: 'Synthetic account' }))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
