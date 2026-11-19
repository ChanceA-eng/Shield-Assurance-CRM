import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { teamInviteRedirect } from './agency-membership';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { requireAgencyOwner } from './agency-access';
import { WorkspaceError } from './record-scope';
import { GET, PATCH, POST } from '../app/api/agency/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-access', () => ({ requireAgencyOwner: vi.fn() }));

const id = 'cf98e001-b31a-4fbc-9eba-31ac9215d439';
const member = { user_id: id, email: 'owner@example.invalid', role: 'owner' as const, active: true,
  sender_profile: null, gmail_ai_opt_in: false };
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['CRM_MULTI_AGENT_ENABLED', 'CRM_GMAIL_ENABLED', 'CRM_INVITE_REDIRECT_URI', 'CRM_WEB_ORIGIN',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI', 'GMAIL_TOKEN_KEYS', 'GMAIL_TOKEN_KEY_VERSION',
    'GMAIL_PUBSUB_TOPIC', 'GMAIL_PUBSUB_AUDIENCE', 'GMAIL_PUBSUB_SERVICE_ACCOUNT']) {
    vi.stubEnv(name, '');
  }
  vi.mocked(getApiSession).mockResolvedValue({ error: null, user: {
    id, email: member.email, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-05T00:00:00Z',
  } });
  vi.mocked(requireAgencyOwner).mockResolvedValue(member);
});
afterEach(() => vi.unstubAllEnvs());

describe('owner Team setup', () => {
  it('requires a trusted activation destination, not Gmail configuration', () => {
    expect(teamInviteRedirect()).toBeNull();
    vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
    expect(teamInviteRedirect()).toBe('https://crm.example.invalid/auth/accept');
    vi.stubEnv('CRM_INVITE_REDIRECT_URI', 'https://crm.example.invalid/login');
    expect(teamInviteRedirect()).toBeNull();
  });
  it('shows that the owner can invite with Gmail and the sender rollout disabled', async () => {
    vi.stubEnv('CRM_INVITE_REDIRECT_URI', 'https://crm.example.invalid/auth/accept');
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).includes('/team_access_rollout')
      ? Response.json({ code: 'PGRST205' }, { status: 404 }) : Response.json([member]));
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    const response = await GET(new NextRequest('https://crm.example.invalid/api/agency?team=true'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, can_invite: true, issues: [], members: [member] });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('sends an owner invitation without Gmail and verifies activation separately from sender setup', async () => {
    vi.stubEnv('CRM_INVITE_REDIRECT_URI', 'https://crm.example.invalid/auth/accept');
    const newId = 'cf98e001-b31a-4fbc-9eba-31ac9215d440';
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const { pathname, searchParams } = new URL(input instanceof Request ? input.url : input);
      if (pathname === '/rest/v1/team_access_rollout') return Response.json({ enabled: false, enforcement_version: 0 });
      let payload: unknown;
      if (pathname === '/auth/v1/invite') payload = { id: newId, email: 'new@example.invalid' };
      else if (init?.method === 'POST') payload = null;
      else payload = searchParams.get('user_id') ? [member] : [];
      return Response.json(payload);
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    const invite = (confirm_crm_access: boolean) => POST(new NextRequest('https://crm.example.invalid/api/agency', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.invalid', confirm_crm_access }),
    }));
    expect((await invite(false)).status).toBe(400);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/auth/v1/invite'))).toBe(false);
    const response = await invite(true);
    expect(response.status, await response.text()).toBe(201);
    const call = fetcher.mock.calls.find(([url]) => String(url).includes('/auth/v1/invite'));
    expect(call && new URL(String(call[0])).searchParams.get('redirect_to')).toBe('https://crm.example.invalid/auth/accept');
    expect(fetcher.mock.calls.some(([url, init]) => String(url).includes('/rest/v1/agency_members')
      && init?.method === 'POST' && JSON.parse(String(init.body)).user_id === newId)).toBe(true);
    const activation = await GET(new NextRequest('https://crm.example.invalid/api/agency?activation=true'));
    expect(activation.status).toBe(200);
    expect(await activation.json()).toEqual({ needsActivation: false });
    expect((await GET(new NextRequest('https://crm.example.invalid/api/agency'))).status).toBe(503);
  });
  it('does not disclose team setup or membership to nonowners', async () => {
    const fetcher = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    vi.mocked(requireAgencyOwner).mockRejectedValue(new WorkspaceError('Owner access required.', 403));
    const response = await GET(new NextRequest('https://crm.example.invalid/api/agency?team=true'));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not let the owner deactivate their own access through legacy Team settings', async () => {
    const fetcher = vi.fn(async () => Response.json([member]));
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    const response = await PATCH(new NextRequest('https://crm.example.invalid/api/agency', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, role: 'agent', active: false }),
    }));
    expect(response.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps new role invitations disabled and rejects pending activation while enforcement is off', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path.endsWith('/team_access_rollout')) return Response.json({ enabled: false, enforcement_version: 0 });
      if (path.endsWith('/agency_members')) return Response.json([{ ...member, active: false, invitation_id: id }]);
      throw new Error(`Unexpected external request: ${path}`);
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    expect(await (await GET(new NextRequest('https://crm.example.invalid/api/agency?access=true'))).json()).toEqual({ ready: false });
    expect((await POST(new NextRequest('https://crm.example.invalid/api/agency?access=true', {
      method: 'POST', body: JSON.stringify({ action: 'invite' }),
    }))).status).toBe(503);
    expect((await POST(new NextRequest('https://crm.example.invalid/api/agency?activation=true', { method: 'POST' }))).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('passes the chosen role and exceptions to the invitation transaction and records the recipient', async () => {
    vi.stubEnv('CRM_INVITE_REDIRECT_URI', 'https://crm.example.invalid/auth/accept');
    const inviteId = 'cf98e001-b31a-4fbc-9eba-31ac9215d440';
    const recipient = 'cf98e001-b31a-4fbc-9eba-31ac9215d441';
    const expected = { 'social.edit': { effect: 'deny' } };
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const { pathname } = new URL(input instanceof Request ? input.url : input);
      if (pathname.endsWith('/team_access_rollout')) return Response.json({ enabled: true, enforcement_version: 1 });
      if (pathname.endsWith('/team_role_bundles')) return Response.json([{ version: 3, grants: { 'social.view': 'agency', 'social.edit': 'agency' } }]);
      calls.push({ endpoint: pathname, payload: JSON.parse(String(init?.body)) });
      if (pathname.endsWith('/create_team_invitation')) return Response.json({ state: 'pending', version: 1 });
      if (pathname === '/auth/v1/invite') return Response.json({ id: recipient, email: 'writer@example.invalid' });
      if (pathname.endsWith('/record_team_invitation_delivery')) return Response.json({ state: 'sent' });
      throw new Error(`Unexpected external request: ${pathname}`);
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    const invite = (roleVersion: number) => POST(new NextRequest('https://crm.example.invalid/api/agency?access=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invite', id: inviteId, role_id: 'content-writer', role_version: roleVersion,
        email: 'writer@example.invalid', exceptions: expected }),
    }));
    expect((await invite(2)).status).toBe(409);
    expect(calls).toHaveLength(0);
    const result = await invite(3);
    expect(result.status, await result.text()).toBe(201);
    expect(calls).toMatchObject([
      { endpoint: '/rest/v1/rpc/create_team_invitation', payload: {
        p_actor: id, p_id: inviteId, p_role_id: 'content-writer', p_role_version: 3, p_exceptions: expected,
      } },
      { endpoint: '/auth/v1/invite', payload: { email: 'writer@example.invalid' } },
      { endpoint: '/rest/v1/rpc/record_team_invitation_delivery', payload: { p_id: inviteId, p_user: recipient, p_expected_version: 1 } },
    ]);
  });

  it('activates only the invitation bound to the signed-in recipient', async () => {
    const inviteId = 'cf98e001-b31a-4fbc-9eba-31ac9215d440';
    const calls: unknown[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const { pathname, searchParams } = new URL(input instanceof Request ? input.url : input);
      if (pathname.endsWith('/agency_members')) return Response.json([{ active: false, invitation_id: inviteId }]);
      if (pathname.endsWith('/team_access_rollout')) return Response.json({ enabled: true, enforcement_version: 1 });
      if (pathname.endsWith('/team_invitations')) {
        expect(searchParams.get('user_id')).toBe(`eq.${id}`);
        return Response.json([{ state: 'sent' }]);
      }
      if (pathname.endsWith('/accept_team_invitation')) {
        calls.push(JSON.parse(String(init?.body)));
        return Response.json({ user_id: id, role_id: 'content-writer' });
      }
      throw new Error(`Unexpected external request: ${pathname}`);
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key',
      { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }));
    const url = 'https://crm.example.invalid/api/agency?activation=true';
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ needsActivation: true });
    expect(calls).toHaveLength(0);
    const result = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify({ user_id: inviteId }) }));
    expect(result.status, await result.text()).toBe(200);
    expect(calls).toEqual([{ p_user: id, p_id: inviteId }]);
  });
});
