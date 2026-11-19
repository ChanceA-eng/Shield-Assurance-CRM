import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { openGmailSecret, sealGmailSecret } from './gmail-provider';
import { ZOOM_SCOPES, zoomAuthorizedRequest, zoomCallbackUrl, zoomHasScopes } from './zoom-provider';
import { POST as connect } from '../app/api/zoom/connect/route';
import { GET as callback } from '../app/api/zoom/callback/route';
import { GET as status, DELETE as disconnect } from '../app/api/zoom/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const actor = '10000000-0000-4000-8000-000000000001';
let db: SupabaseClient, validState: boolean, active: boolean, expired: boolean, refreshError: boolean;
let calls: Array<{ name: string; method: string; url: URL; body: Record<string, unknown> | null }>;
let providerCalls: Array<{ url: URL; init?: RequestInit }>;
beforeEach(() => {
  vi.clearAllMocks(); validState = true; active = true; expired = false; refreshError = false; calls = []; providerCalls = [];
  vi.stubEnv('ZOOM_CLIENT_ID', 'zoom-qa-client'); vi.stubEnv('ZOOM_CLIENT_SECRET', 'zoom-qa-secret');
  vi.stubEnv('ZOOM_OAUTH_REDIRECT_URI', '');
  vi.stubEnv('GMAIL_OAUTH_REDIRECT_URI', 'https://crm.example.invalid/api/gmail/callback');
  vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v1'); vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
  vi.mocked(getApiSession).mockResolvedValue({
    user: { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }, error: null,
  });
  const credentials = () => ({
    refresh_secret: sealGmailSecret('qa-old-refresh', actor), access_secret: sealGmailSecret('qa-old-access', actor),
    access_expires_at: expired ? '2020-01-01' : '2040-01-01',
  });
  db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input)), name = url.pathname.split('/').pop()!, method = init?.method ?? 'GET';
      calls.push({ name, method, url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null });
      if (name === 'agency_members') return Response.json({ user_id: actor, active });
      if (name === 'zoom_connections') return Response.json({ user_id: actor, email: 'agent@example.invalid', status: 'connected' });
      if (name === 'zoom_credentials') return Response.json(method === 'PATCH' ? { user_id: actor } : credentials());
      if (name === 'claim_zoom_refresh') return Response.json(credentials());
      if (name === 'zoom_oauth_states' && method === 'DELETE') {
        const valid = validState; validState = false;
        return Response.json(valid ? { state_hash: 'hash' } : null);
      }
      return Response.json(null);
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input); providerCalls.push({ url, init });
    if (url.pathname === '/oauth/token') return refreshError ? Response.json({}, { status: 400 }) : Response.json({
      access_token: 'qa-new-access', refresh_token: 'qa-new-refresh', expires_in: 3600, scope: ZOOM_SCOPES.join(' '),
    });
    if (url.pathname === '/v2/users/me') return Response.json({ id: 'zoom-person', email: 'Agent@Example.invalid', status: 'active' });
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (cookie = true) => new NextRequest('https://crm.example.invalid/api/zoom/callback?state=state&code=code', {
  headers: cookie ? { cookie: 'crm-zoom-oauth=browser' } : {},
});
it('uses a canonical isolated Zoom redirect with hashed browser-bound state and no Gmail changes', async () => {
  const response = await connect(new NextRequest('https://preview.example.invalid/api/zoom/connect', { method: 'POST' }));
  expect(response.status).toBe(200);
  const url = new URL((await response.json() as { url: string }).url);
  expect(url.origin).toBe('https://zoom.us');
  expect(url.searchParams.get('redirect_uri')).toBe('https://crm.example.invalid/api/zoom/callback');
  const saved = calls.find((call) => call.name === 'zoom_oauth_states')?.body;
  expect(saved?.state_hash).not.toBe(url.searchParams.get('state'));
  expect(saved?.user_id).toBe(actor);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
  expect(providerCalls).toHaveLength(0);
  expect(calls.some((call) => call.name.startsWith('gmail_') || call.name.startsWith('google_calendar_'))).toBe(false);
});
it('consumes authenticated state once and stores encrypted Zoom credentials for an active identity', async () => {
  const response = await callback(request());
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('https://crm.example.invalid/account?tab=signature&zoom=connected');
  const saved = calls.find((call) => call.name === 'connect_zoom')?.body;
  expect(saved).toMatchObject({ p_user: actor, p_subject: 'zoom-person', p_email: 'agent@example.invalid' });
  expect(openGmailSecret(String(saved?.p_refresh), actor)).toBe('qa-new-refresh');
  expect(JSON.stringify(saved)).not.toContain('qa-new-access');
  const claim = calls.find((call) => call.name === 'zoom_oauth_states');
  expect(claim?.url.searchParams.get('user_id')).toBe(`eq.${actor}`);
  expect(claim?.url.searchParams.has('browser_hash')).toBe(true);
  expect(claim?.url.searchParams.has('expires_at')).toBe(true);
  expect((await callback(request())).status).toBe(400);
  expect(providerCalls.filter((call) => call.url.pathname === '/oauth/token')).toHaveLength(1);
});
it.each(['browser', 'state', 'member', 'auth'])('rejects invalid OAuth session (%s) before exchanging credentials', async (missing) => {
  if (missing === 'state') validState = false;
  if (missing === 'member') active = false;
  if (missing === 'auth') vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({}, { status: 401 }) });
  expect((await callback(request(missing !== 'browser'))).status).toBeGreaterThanOrEqual(400);
  expect(providerCalls).toHaveLength(0);
});
it('exposes unconfigured status without producing a broken authorization URL', async () => {
  vi.stubEnv('ZOOM_CLIENT_ID', '');
  expect(await (await status(new NextRequest('https://crm.example.invalid/api/zoom'))).json()).toMatchObject({ configured: false });
  expect((await connect(new NextRequest('https://crm.example.invalid/api/zoom/connect', { method: 'POST' }))).status).toBe(503);
  expect(providerCalls).toHaveLength(0);
});
it('refreshes rotating tokens under a durable lease and persists both encrypted new tokens before API use', async () => {
  expired = true;
  await (await zoomAuthorizedRequest(db, actor))('/users/me');
  const claim = calls.find((call) => call.name === 'claim_zoom_refresh')?.body;
  expect(claim).toMatchObject({ p_user: actor, p_lock: expect.any(String) });
  const saved = calls.find((call) => call.name === 'zoom_credentials' && call.body?.refresh_secret);
  expect(saved?.url.searchParams.get('refresh_lock')).toBe(`eq.${claim?.p_lock}`);
  expect(openGmailSecret(String(saved?.body?.refresh_secret), actor)).toBe('qa-new-refresh');
  expect(openGmailSecret(String(saved?.body?.access_secret), actor)).toBe('qa-new-access');
  expect(providerCalls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer qa-new-access' });
  expect(providerCalls[0]?.init?.body).toContain('grant_type=refresh_token');
  expect(calls.at(-1)?.body).toEqual({ refresh_lock: null, refresh_lease_until: null });
});
it('does not refresh an unexpired token and marks failed refresh for reconnect without blind token reuse', async () => {
  await (await zoomAuthorizedRequest(db, actor))('/users/me');
  expect(calls.some((call) => call.name === 'claim_zoom_refresh')).toBe(false);
  expired = true; refreshError = true;
  await expect(zoomAuthorizedRequest(db, actor)).rejects.toThrow('Reconnect Zoom');
  expect(calls.some((call) => call.name === 'zoom_connections' && call.body?.status === 'reconnect')).toBe(true);
});
it('disconnects only Zoom through its guarded RPC, never Google or Gmail', async () => {
  expect((await disconnect(new NextRequest('https://crm.example.invalid/api/zoom', { method: 'DELETE' }))).status).toBe(200);
  expect(calls.some((call) => call.name === 'disconnect_zoom')).toBe(true);
  expect(providerCalls).toHaveLength(0);
  expect(calls.some((call) => call.name.startsWith('gmail_') || call.name.startsWith('google_calendar_'))).toBe(false);
});
it('requires complete meeting scopes and validates the exact redirect path and secure origin', () => {
  expect(zoomHasScopes(ZOOM_SCOPES.join(' '))).toBe(true);
  expect(zoomHasScopes('user:read:user')).toBe(false);
  vi.stubEnv('ZOOM_OAUTH_REDIRECT_URI', 'http://crm.example.invalid/api/zoom/callback');
  expect(() => zoomCallbackUrl()).toThrow('administrator');
  vi.stubEnv('ZOOM_OAUTH_REDIRECT_URI', 'https://crm.example.invalid/api/gmail/callback');
  expect(() => zoomCallbackUrl()).toThrow('administrator');
});
