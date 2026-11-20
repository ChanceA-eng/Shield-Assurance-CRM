import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET, POST } from '../app/api/agency/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { sendTeamInviteMail } from './account-mail';
import { teamInviteRedirect } from './agency-membership';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./account-mail', () => ({ accountMailReady: () => true, sendTeamInviteMail: vi.fn() }));

const actor = 'cf98e001-b31a-4fbc-9eba-31ac9215d439';
const recipient = 'cf98e001-b31a-4fbc-9eba-31ac9215d440';
const endpoint = 'https://crm.example.invalid/api/agency';
const post = (body: object, url = `${endpoint}?team=true`) => POST(new NextRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const useFetch = (fetch: typeof globalThis.fetch): void => {
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
  vi.stubEnv('CRM_INVITE_REDIRECT_URI', 'http://localhost:3000/auth/accept');
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: {
    id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-05T00:00:00Z',
  } });
});
afterEach(() => vi.unstubAllEnvs());

it.each([true, false])('stores the chosen title and exact grants with no active access before setup (mail accepted: %s)', async (accepted) => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    if (pathname.endsWith('/team_profile_manager')) return Response.json(true);
    if (pathname.endsWith('/agency_members')) return new URL(input instanceof Request ? input.url : input).searchParams.has('user_id')
      ? Response.json({ direct_grants: null }) : Response.json([]);
    if (pathname.endsWith('/generate_link')) return Response.json({ id: recipient, hashed_token: 'synthetic-invite-proof' });
    if (pathname.endsWith('/save_team_profile') || pathname.endsWith('/record_team_setup_email')) return Response.json(null);
    throw new Error(`Unexpected request: ${pathname}`);
  });
  useFetch(fetcher);
  if (!accepted) vi.mocked(sendTeamInviteMail).mockRejectedValueOnce(new Error('Delivery unavailable'));
  const response = await post({ action: 'invite', full_name: 'Sample Member', email: 'staff@example.invalid',
    role_title: 'Renewal Coordinator', grants: { 'leads.view': 'assigned' } });
  const text = await response.text();
  expect(response.status, text).toBe(accepted ? 200 : 503);
  expect(text).not.toContain('synthetic-invite-proof');
  const rpc = (name: string) => {
    const request = fetcher.mock.calls.find(([url]) => String(url).endsWith(`/rpc/${name}`));
    return JSON.parse(String(request?.[1]?.body));
  };
  expect(rpc('save_team_profile')).toMatchObject({ p_target: recipient, p_title: 'Renewal Coordinator',
    p_grants: { 'leads.view': 'assigned' }, p_active: false });
  expect(rpc('record_team_setup_email')).toMatchObject({ p_target: recipient, p_sent: accepted });
  expect(sendTeamInviteMail).toHaveBeenCalledWith('staff@example.invalid', 'https://crm.example.invalid/auth/accept', 'synthetic-invite-proof', 'invite');
});

it('blocks staff from reading the roster or issuing invitations even if they submit an administrator title', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(false));
  useFetch(fetcher);
  expect((await GET(new NextRequest(`${endpoint}?team=true`))).status).toBe(403);
  expect((await post({ action: 'invite', role_title: 'Administrator' })).status).toBe(403);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/team_profile_manager'))).toBe(true);
  expect(sendTeamInviteMail).not.toHaveBeenCalled();
});

it('rejects excessive delegated grants before creating a sign-in account', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/team_profile_manager')) return Response.json(true);
    if (url.pathname.endsWith('/agency_members')) return url.searchParams.has('user_id')
      ? Response.json({ direct_grants: { 'team.manage': 'agency', 'leads.view': 'assigned' } }) : Response.json([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  useFetch(fetcher);
  const response = await post({ action: 'invite', full_name: 'Sample Member', email: 'staff@example.invalid',
    role_title: 'Custom title', grants: { 'leads.view': 'agency' } });
  expect(response.status).toBe(403);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/generate_link'))).toBe(false);
  expect(sendTeamInviteMail).not.toHaveBeenCalled();
});

it('activates only the signed-in recipient, not a user ID supplied by the browser', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/accept_team_profile')
    ? Response.json(null) : Response.json([{ setup_state: 'sent', active: false }]));
  useFetch(fetcher);
  const url = `${endpoint}?activation=true`;
  expect(await (await GET(new NextRequest(url))).json()).toEqual({ needsActivation: true });
  expect((await post({ user_id: recipient }, url)).status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ p_actor: actor });
});

it('refuses to email loopback links if no public CRM origin exists', () => {
  expect(teamInviteRedirect()).toBe('https://crm.example.invalid/auth/accept');
  vi.stubEnv('CRM_WEB_ORIGIN', '');
  expect(teamInviteRedirect()).toBeNull();
});
