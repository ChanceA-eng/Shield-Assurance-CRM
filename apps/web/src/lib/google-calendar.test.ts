import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { sealGmailSecret } from './gmail-provider';
import { CALENDAR_SCOPES, calendarBusy, calendarCallbackUrl, calendarHasScopes } from './google-calendar';
import { POST as connect } from '../app/api/google-calendar/connect/route';
import { GET as callback } from '../app/api/google-calendar/callback/route';
import { DELETE as disconnect } from '../app/api/google-calendar/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const user = '10000000-0000-4000-8000-000000000001';
let calls: Array<{ name: string; method: string; url: URL; body: Record<string, unknown> | null }>;
let stateValid: boolean, active: boolean;
let tokenSpy: MockInstance<OAuth2Client['getToken']>;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; stateValid = true; active = true;
  vi.stubEnv('GOOGLE_CLIENT_ID', 'qa-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'qa-placeholder');
  vi.stubEnv('GMAIL_OAUTH_REDIRECT_URI', 'https://crm.example.invalid/api/gmail/callback');
  vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v1'); vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: user, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }, error: null });
  tokenSpy = vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation(async () => ({ tokens: {
    access_token: 'qa-access', refresh_token: 'qa-refresh', id_token: 'qa-id', scope: CALENDAR_SCOPES.join(' '),
  }, res: null }));
  const ticket = new LoginTicket(undefined, { iss: 'https://accounts.google.com', sub: 'calendar-user', aud: 'qa-client', iat: 1, exp: 9999999999, email: 'Agent@Example.invalid', email_verified: true });
  vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation(async () => ticket);
  const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input)), name = url.pathname.split('/').pop()!, method = init?.method ?? 'GET';
      calls.push({ name, method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null });
      if (name === 'agency_members') return Response.json({ user_id: user, active });
      if (name === 'google_calendar_connections') return Response.json({ user_id: user, email: 'agent@example.invalid', status: 'connected' });
      if (name === 'google_calendar_credentials') return Response.json({ refresh_secret: sealGmailSecret('refresh', user), access_secret: sealGmailSecret('access', user), access_expires_at: '2040-01-01' });
      if (name === 'google_calendar_oauth_states' && method === 'DELETE') {
        const valid = stateValid; stateValid = false;
        return Response.json(valid ? { verifier_secret: sealGmailSecret('qa-verifier', user) } : null);
      }
      return Response.json(null);
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (cookie = true) => new NextRequest('https://crm.example.invalid/api/google-calendar/callback?state=state&code=code', { headers: cookie ? { cookie: 'crm-calendar-oauth=browser' } : {} });

it('uses canonical Calendar callback, minimal Calendar scopes and isolated encrypted PKCE state', async () => {
  const response = await connect(new NextRequest('https://preview.example.invalid/api/google-calendar/connect', { method: 'POST' }));
  expect(response.status).toBe(200);
  const url = new URL((await response.json() as { url: string }).url);
  expect(url.searchParams.get('redirect_uri')).toBe('https://crm.example.invalid/api/google-calendar/callback');
  expect(url.searchParams.get('scope')?.split(' ')).toEqual(CALENDAR_SCOPES);
  expect(url.searchParams.get('scope')).not.toContain('gmail');
  expect(url.searchParams.get('include_granted_scopes')).toBe('false');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(response.headers.get('set-cookie')).toContain('crm-calendar-oauth');
  const state = calls.find((call) => call.name === 'google_calendar_oauth_states')?.body;
  expect(state?.user_id).toBe(user);
  expect(state?.state_hash).not.toBe(url.searchParams.get('state'));
  expect(state?.verifier_secret).toMatch(/^v1\./);
  expect(calls.some((call) => call.name.startsWith('gmail_'))).toBe(false);
});
it('consumes authenticated browser/user-bound state once and stores encrypted separate credentials', async () => {
  expect((await callback(request())).status).toBe(307);
  const claim = calls.find((call) => call.name === 'google_calendar_oauth_states');
  expect(claim?.url.searchParams.get('user_id')).toBe(`eq.${user}`);
  expect(claim?.url.searchParams.has('browser_hash')).toBe(true);
  expect(claim?.url.searchParams.has('expires_at')).toBe(true);
  const saved = calls.find((call) => call.name === 'connect_google_calendar')?.body;
  expect(saved).toMatchObject({ p_user: user, p_email: 'agent@example.invalid', p_subject: 'calendar-user' });
  expect(JSON.stringify(saved)).not.toContain('qa-refresh');
  expect(tokenSpy).toHaveBeenCalledWith({ code: 'code', codeVerifier: 'qa-verifier' });
  expect((await callback(request())).status).toBe(400);
  expect(tokenSpy).toHaveBeenCalledTimes(1);
  expect(calls.some((call) => call.name.startsWith('gmail_'))).toBe(false);
});
it.each(['browser', 'state', 'scope', 'offline'])('rejects tampered or incomplete Calendar consent (%s)', async (missing) => {
  if (missing === 'state') stateValid = false;
  if (missing === 'scope' || missing === 'offline') tokenSpy.mockImplementation(async () => ({ tokens: {
    access_token: 'qa', refresh_token: missing === 'offline' ? undefined : 'qa-refresh', id_token: 'qa-id',
    scope: missing === 'scope' ? CALENDAR_SCOPES.slice(0, -1).join(' ') : CALENDAR_SCOPES.join(' '),
  }, res: null }));
  expect((await callback(request(missing !== 'browser'))).status).toBe(400);
  if (missing === 'browser' || missing === 'state') expect(tokenSpy).not.toHaveBeenCalled();
  expect(calls.some((call) => call.name === 'connect_google_calendar')).toBe(false);
});
it('requires authentication and active membership even for the public callback', async () => {
  active = false;
  expect((await callback(request())).status).toBe(403);
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({}, { status: 401 }) });
  expect((await connect(new NextRequest('https://crm.example.invalid/api/google-calendar/connect', { method: 'POST' }))).status).toBe(401);
  expect(tokenSpy).not.toHaveBeenCalled();
});
it('disconnects locally without revoking the OAuth client grant or modifying Gmail', async () => {
  const revoke = vi.spyOn(OAuth2Client.prototype, 'revokeToken');
  expect((await disconnect(new NextRequest('https://crm.example.invalid/api/google-calendar', { method: 'DELETE' }))).status).toBe(200);
  expect(calls.some((call) => call.name === 'disconnect_google_calendar')).toBe(true);
  expect(calls.some((call) => call.name.startsWith('gmail_'))).toBe(false);
  expect(revoke).not.toHaveBeenCalled();
});
it('validates callback configuration and complete Calendar permissions', () => {
  expect(calendarHasScopes(CALENDAR_SCOPES.join(' '))).toBe(true);
  expect(calendarHasScopes('https://www.googleapis.com/auth/gmail.send')).toBe(false);
  vi.stubEnv('GMAIL_OAUTH_REDIRECT_URI', 'https://crm.example.invalid/not-a-callback');
  expect(() => calendarCallbackUrl()).toThrow('canonical');
});
it('fails closed on provider availability errors rather than treating them as free', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ calendars: { primary: { errors: [{ reason: 'forbidden' }], busy: [] } } })));
  await expect(calendarBusy(getSupabaseServerClient()!, user, '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z')).rejects.toThrow('could not be verified');
});
it('excludes only the existing event when checking reschedule conflicts', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [
    { id: 'existing', start: { dateTime: '2030-01-01T10:00:00Z' }, end: { dateTime: '2030-01-01T10:30:00Z' } },
    { id: 'other', start: { dateTime: '2030-01-01T10:15:00Z' }, end: { dateTime: '2030-01-01T11:00:00Z' } },
  ] })));
  expect(await calendarBusy(getSupabaseServerClient()!, user, '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z', 'existing')).toEqual([
    { start: '2030-01-01T10:15:00Z', end: '2030-01-01T11:00:00Z' },
  ]);
});
