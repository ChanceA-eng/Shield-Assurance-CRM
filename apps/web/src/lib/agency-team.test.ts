import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET, POST } from '../app/api/agency/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { sendAccountMail, sendTeamInviteMail } from './account-mail';
import { teamInviteRedirect } from './agency-membership';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./account-mail', () => ({ accountMailReady: () => true, sendTeamInviteMail: vi.fn(), sendAccountMail: vi.fn() }));

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
    if (pathname.endsWith('/save_team_profile') || pathname.endsWith('/begin_team_setup') || pathname.endsWith('/finish_team_setup')) return Response.json(null);
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
  expect(rpc('finish_team_setup')).toMatchObject({ p_target: recipient, p_sent: accepted, p_digest: rpc('begin_team_setup').p_digest });
  expect(sendTeamInviteMail).toHaveBeenCalledWith('staff@example.invalid', 'https://crm.example.invalid/auth/accept',
    recipient, expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
});

it('blocks staff from reading the roster or issuing invitations even if they submit an administrator title', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(false));
  useFetch(fetcher);
  expect((await GET(new NextRequest(`${endpoint}?team=true`))).status).toBe(403);
  expect((await post({ action: 'invite', role_title: 'Administrator' })).status).toBe(403);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/team_profile_manager'))).toBe(true);
  expect(sendTeamInviteMail).not.toHaveBeenCalled();
});

it('rejects invitations without permissions before creating a sign-in account', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(true));
  useFetch(fetcher);
  const response = await post({ action: 'invite', full_name: 'Sample Member', email: 'staff@example.invalid',
    role_title: 'Other', grants: {} });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain('Choose at least one permission');
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/team_profile_manager'))).toBe(true);
  expect(sendTeamInviteMail).not.toHaveBeenCalled();
});

it('saves an editable preset through the authorized versioned database function', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(null));
  fetcher.mockImplementationOnce(async () => Response.json(true));
  useFetch(fetcher);
  const response = await post({ action: 'preset', id: recipient, version: 3, name: '  Producer  ',
    active: false, grants: { 'leads.view': 'assigned' } });
  expect(response.status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({
    p_actor: actor, p_id: recipient, p_version: 3, p_name: 'Producer',
    p_active: false, p_grants: { 'leads.view': 'assigned' },
  });
});

it('rejects invalid preset dependencies before the database save', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(true));
  useFetch(fetcher);
  const response = await post({ action: 'preset', id: null, version: null, name: 'Producer',
    active: true, grants: { 'leads.edit': 'assigned' } });
  expect(response.status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('saves profile contact data using the signed-in actor and expected version', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(null));
  fetcher.mockImplementationOnce(async () => Response.json(true));
  useFetch(fetcher);
  const result = await post({ action: 'profile', user_id: recipient, version: 3, full_name: ' Member ',
    phone: '520-555-0101', address: 'Example address' });
  expect(result.status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({
    p_actor: actor, p_target: recipient, p_version: 3, p_name: 'Member', p_phone: '520-555-0101', p_address: 'Example address',
  });
});

it('loads contact details only for the selected member through the authorization RPC', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toContain('/rpc/read_team_contact');
    expect(JSON.parse(String(init?.body))).toEqual({ p_actor: actor, p_target: recipient });
    return Response.json({ name: 'Member', phone: '555-0101', address: 'Private address', version: 2 });
  });
  useFetch(fetcher);
  const response = await GET(new NextRequest(`${endpoint}?team=true&profile=${recipient}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ address: 'Private address', version: 2 });
});

it('sends an active member a recovery link only after current authorization is checked', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/team_profile_manager') || url.pathname.endsWith('/reserve_account_security')) return Response.json(true);
    if (url.pathname.endsWith('/authorize_team_reset')) return Response.json('staff@example.invalid');
    if (url.pathname.endsWith('/generate_link')) return Response.json({ id: recipient, hashed_token: 'synthetic-recovery-proof' });
    if (url.pathname.endsWith('/record_team_reset')) return Response.json(null);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  useFetch(fetcher);
  const result = await post({ action: 'reset', user_id: recipient });
  expect(result.status).toBe(200);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/authorize_team_reset'))).toHaveLength(2);
  expect(sendAccountMail).toHaveBeenCalledWith('staff@example.invalid', 'Reset your Shield CRM password',
    expect.stringContaining('/auth/confirm#type=recovery&token_hash=synthetic-recovery-proof'), 'synthetic-recovery-proof');
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ p_actor: actor, p_target: recipient, p_sent: true });
  expect(await result.text()).not.toContain('synthetic-recovery-proof');
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

it('verifies and activates only the signed-in recipient with its setup challenge', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/rpc/')
    ? Response.json(null) : Response.json([{ setup_state: 'sent', active: false }]));
  useFetch(fetcher);
  const url = `${endpoint}?activation=true`;
  expect(await (await GET(new NextRequest(url))).json()).toEqual({ needsActivation: true, challengeRequired: true });
  expect((await post({ user_id: recipient }, url)).status).toBe(403);
  const challenge = 'a'.repeat(43);
  expect((await post({ action: 'verify', challenge }, url)).status).toBe(200);
  expect((await post({ action: 'complete', challenge, user_id: recipient, phone: '520-555-0101', address: 'Example address' }, url)).status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ p_actor: actor,
    p_digest: expect.stringMatching(/^[a-f0-9]{64}$/), p_phone: '520-555-0101', p_address: 'Example address' });
});

it('refuses to email loopback links if no public CRM origin exists', () => {
  expect(teamInviteRedirect()).toBe('https://crm.example.invalid/auth/accept');
  vi.stubEnv('CRM_WEB_ORIGIN', '');
  expect(teamInviteRedirect()).toBeNull();
});
