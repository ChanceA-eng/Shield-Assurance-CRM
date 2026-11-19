import { beforeEach, afterEach, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { getSupabaseServerClient } from './supabase-server';
import { getApiSession } from './api-auth';
import { GMAIL_SCOPES, GMAIL_SEND_ONLY_SCOPES, sealGmailSecret } from './gmail-provider';
import { GET as callback } from '../app/api/gmail/callback/route';
import { POST as connect } from '../app/api/gmail/connect/route';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
const user = '10000000-0000-4000-8000-000000000001';
let claimed: boolean;
let claimedScopeMode: 'shared_sync' | 'send_only';
let calls: Array<{ name: string; method: string; url: URL; body: Record<string, unknown> | null }>;
let tokenSpy: MockInstance<OAuth2Client['getToken']>;
beforeEach(() => {
  vi.clearAllMocks(); claimed = false; claimedScopeMode = 'shared_sync'; calls = [];
  vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true'); vi.stubEnv('CRM_GMAIL_ENABLED', 'true');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'qa-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'qa-placeholder');
  vi.stubEnv('GMAIL_OAUTH_REDIRECT_URI', 'https://crm.example.invalid/api/gmail/callback');
  vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v1'); vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: user, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-31T12:00:00Z' }, error: null });
  tokenSpy = vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation(async () => ({ tokens: {
    access_token: 'qa-access', refresh_token: 'qa-refresh', scope: GMAIL_SCOPES.join(' '), expiry_date: Date.now() + 3600000,
  }, res: null }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ emailAddress: 'Agent@Example.invalid' })));
  const db = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
      const parsed = new URL(String(url)); const name = parsed.pathname.split('/').pop() ?? '';
      const method = init?.method ?? 'GET'; const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ name, method, url: parsed, body });
      if (name === 'agency_members') return Response.json({ user_id: user, active: true, role: 'agent', sender_profile: null, gmail_ai_opt_in: false });
      if (name === 'gmail_oauth_states' && method === 'DELETE') {
        if (claimed) return Response.json(null);
        claimed = true; return Response.json({ verifier_secret: sealGmailSecret('qa-verifier', user), scope_mode: claimedScopeMode });
      }
      if (name === 'connect_agent_gmail') return Response.json('mailbox1');
      return Response.json(null);
    } },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (cookie = true) => new NextRequest('https://crm.example.invalid/api/gmail/callback?state=state&code=code', { headers: cookie ? { cookie: 'crm-gmail-oauth=browser' } : {} });
it('requires explicit shared-thread disclosure acceptance before issuing authorization', async () => {
  expect((await connect(new NextRequest('https://crm.example.invalid/api/gmail/connect', { method: 'POST', body: JSON.stringify({ accept_shared_crm_sync: false }) }))).status).toBe(400);
  expect(calls.some((call) => call.name === 'gmail_oauth_states')).toBe(false);
  const response = await connect(new NextRequest('https://crm.example.invalid/api/gmail/connect', { method: 'POST', body: JSON.stringify({ accept_shared_crm_sync: true }) }));
  expect(response.status).toBe(200);
  const { url } = await response.json() as { url: string };
  const oauth = new URL(url);
  expect(oauth.searchParams.get('access_type')).toBe('offline');
  expect(oauth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(oauth.searchParams.get('scope')).toContain('gmail.readonly');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
});
it('requests only send and verified identity scopes for the send-only mailbox', async () => {
  const response = await connect(new NextRequest('https://crm.example.invalid/api/gmail/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'send_only', accept_send_only: true }),
  }));
  expect(response.status).toBe(200);
  const { url } = await response.json() as { url: string };
  const requestedScopes = new URL(url).searchParams.get('scope')?.split(' ') ?? [];
  expect(requestedScopes).toEqual(expect.arrayContaining(GMAIL_SEND_ONLY_SCOPES));
  expect(requestedScopes).not.toContain('https://www.googleapis.com/auth/gmail.readonly');
  expect(calls.find((call) => call.name === 'gmail_oauth_states' && call.method === 'POST')?.body)
    .toMatchObject({ scope_mode: 'send_only' });
});
it('consumes browser/user-bound state once and stores only encrypted tokens under the verified mailbox identity', async () => {
  expect((await callback(request())).status).toBe(307);
  const claim = calls.find((call) => call.name === 'gmail_oauth_states');
  expect(claim?.url.searchParams.get('user_id')).toBe(`eq.${user}`);
  expect(claim?.url.searchParams.has('browser_hash')).toBe(true);
  expect(claim?.url.searchParams.has('expires_at')).toBe(true);
  const saved = calls.find((call) => call.name === 'connect_agent_gmail')?.body;
  expect(saved).toMatchObject({ p_user: user, p_email: 'agent@example.invalid' });
  expect(JSON.stringify(saved)).not.toContain('qa-refresh');
  expect(JSON.stringify(saved)).not.toContain('qa-access');
  expect((await callback(request())).status).toBe(400);
  expect(tokenSpy).toHaveBeenCalledTimes(1);
});
it('verifies the Google identity and stores send-only credentials without reading the Gmail profile', async () => {
  claimedScopeMode = 'send_only';
  tokenSpy.mockImplementation(async () => ({ tokens: {
    access_token: 'qa-access',
    refresh_token: 'qa-refresh',
    id_token: 'qa-id-token',
    scope: GMAIL_SEND_ONLY_SCOPES.join(' '),
    expiry_date: Date.now() + 3600000,
  }, res: null }));
  const ticket = new LoginTicket(undefined, {
    iss: 'https://accounts.google.com', sub: 'synthetic-user', aud: 'qa-client',
    iat: 1, exp: 9999999999, email: 'Agent@Example.invalid', email_verified: true,
  });
  vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation((_options, callback) => {
    if (callback) callback(null, ticket);
    return Promise.resolve(ticket);
  });

  const response = await callback(request());
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toContain('/account?tab=signature&gmail=connected');
  expect(calls.find((call) => call.name === 'connect_personal_gmail')?.body)
    .toMatchObject({ p_user: user, p_email: 'agent@example.invalid' });
  expect(calls.some((call) => call.url.hostname === 'gmail.googleapis.com')).toBe(false);
  expect(calls.some((call) => call.name === 'connect_agent_gmail')).toBe(false);
});
it('rejects missing browser binding without exchanging the code', async () => {
  expect((await callback(request(false))).status).toBe(400);
  expect(tokenSpy).not.toHaveBeenCalled();
});
it.each(['scope', 'refresh'])('rejects partial permission/offline consent (%s)', async (missing) => {
  tokenSpy.mockImplementation(async () => ({ tokens: { access_token: 'qa-access', refresh_token: missing === 'refresh' ? undefined : 'qa-refresh', scope: missing === 'scope' ? GMAIL_SCOPES[0] : GMAIL_SCOPES.join(' ') }, res: null }));
  expect((await callback(request())).status).toBe(400);
  expect(calls.some((call) => call.name === 'connect_agent_gmail')).toBe(false);
});
it('requires an authenticated CRM session even when Google supplies a valid callback', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
  expect((await callback(request())).status).toBe(401);
  expect(tokenSpy).not.toHaveBeenCalled();
});
