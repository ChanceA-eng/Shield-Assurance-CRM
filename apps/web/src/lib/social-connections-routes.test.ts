import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { openSocialToken, sealSocialToken } from '@crm/shared/social-token-crypto';
import { GET, POST } from '../app/api/social-marketing/connections/route';
import { POST as startOAuth } from '../app/api/social-marketing/connections/oauth/route';
import { GET as completeOAuth } from '../app/api/social-marketing/connections/callback/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import {
  discoverSocialMetaPages, exchangeSocialMetaCode, getSocialMetaPage, revokeSocialMetaGrant, socialMetaConfigurationIssues,
} from './social-meta-provider';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./social-meta-provider', () => ({
  discoverSocialMetaPages: vi.fn(),
  exchangeSocialMetaCode: vi.fn(),
  getSocialMetaPage: vi.fn(),
  revokeSocialMetaGrant: vi.fn(),
  socialMetaConfigurationIssues: vi.fn(),
  socialMetaCookieNames: () => ({ state: 'crm-social-meta-state', grant: 'crm-social-meta-grant' }),
  socialMetaAuthorizationUrl: (state: string) => `https://www.facebook.com/v27.0/dialog/oauth?state=${state}`,
}));

const actor = '04865539-8320-4031-93de-8047f715f748';
const workspace = '62120357-eaef-42e9-a5c9-c52794c42808';
const grantId = '128b6a5e-4ca6-4b32-a185-7293b4bd4a2d';
const connectionId = '228b6a5e-4ca6-4b32-a185-7293b4bd4a2d';
const userId = '123456789';
const pageId = '987654321';
const userToken = 'user-token-with-enough-length-123456';
const pageToken = 'page-token-with-enough-length-123456';
const oauthCookie = 'crm-social-meta-grant=128b6a5e-4ca6-4b32-a185-7293b4bd4a2d';
const stateCookie = 'crm-social-meta-state=browser-binding-value';
const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const accounts = [{
  id: pageId, name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'],
  can_publish_facebook: true, facebook_block_reason: null,
  instagram_business_account: { id: '123456780', username: 'agency' },
  can_publish_instagram: true, instagram_block_reason: null,
}];
const connections = [{
  id: connectionId, grant_id: grantId, platform: 'facebook_page', external_account_id: pageId,
  account_name: 'Agency Page', username: null, parent_page_id: null, parent_page_name: null,
  can_publish: true, capability_reason: null, granted_scopes: scopes, state: 'connected',
  authorized_by: actor, token_expires_at: null, last_validated_at: null, updated_at: '2026-11-06T12:00:00Z',
}];
const grant = {
  id: grantId, workspace_id: workspace, external_user_id: userId,
  encrypted_user_token: '', granted_scopes: scopes, token_expires_at: '2027-01-01T00:00:00Z',
  expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcHandler: (name: string, args: Record<string, unknown>) => unknown;
let dbFetchCount = 0;
const body = (value: unknown): string => JSON.stringify(value);
function request(path: string, value?: unknown, cookie?: string): NextRequest {
  return new NextRequest(`https://crm.invalid${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    ...(value === undefined ? {} : { body: body(value), headers: { 'Content-Type': 'application/json' } }),
    ...(cookie ? { headers: { 'Content-Type': 'application/json', Cookie: cookie } } : {}),
  });
}
function callbackRequest(query: string, cookie?: string): NextRequest {
  return new NextRequest(`https://crm.invalid/api/social-marketing/connections/callback${query}`, {
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks(); rpcCalls.length = 0; dbFetchCount = 0;
  vi.stubEnv('SOCIAL_META_CONNECTIONS_ENABLED', 'true');
  vi.stubEnv('SOCIAL_META_CLIENT_ID', 'test-app-id');
  vi.stubEnv('SOCIAL_META_CLIENT_SECRET', 'server-only-app-secret');
  vi.stubEnv('SOCIAL_META_REDIRECT_URI', 'https://crm.invalid/api/social-marketing/connections/callback');
  vi.stubEnv('SOCIAL_META_GRAPH_API_VERSION', 'v27.0');
  vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'v1');
  vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(socialMetaConfigurationIssues).mockReturnValue([]);
  vi.mocked(discoverSocialMetaPages).mockResolvedValue(accounts);
  vi.mocked(exchangeSocialMetaCode).mockResolvedValue({
    accessToken: userToken, expiresAt: '2027-01-01T00:00:00.000Z', userId, userName: 'Agency Login', scopes,
  });
  vi.mocked(getSocialMetaPage).mockResolvedValue({
    id: pageId, name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'], access_token: pageToken,
      instagram_business_account: { id: '123456780', username: 'agency' },
  });
  vi.mocked(revokeSocialMetaGrant).mockResolvedValue();
  grant.encrypted_user_token = sealSocialToken(userToken, `${workspace}:meta:user:${userId}`);
  rpcHandler = (name) => {
    if (name === 'list_social_provider_connections') return { can_manage: true, connections, grants: [] };
    if (name === 'consume_social_oauth_state') return { workspace_id: workspace, redirect_uri: 'https://crm.invalid/api/social-marketing/connections/callback' };
    if (name === 'load_social_oauth_grant') return grant;
    if (name === 'store_social_oauth_grant') return { id: grantId, expires_at: grant.expires_at };
    if (name === 'save_social_provider_accounts') return { connections, can_manage: true };
    if (name === 'load_social_provider_revoke') return {
      id: grantId, workspace_id: workspace, external_user_id: userId,
      encrypted_user_token: sealSocialToken(userToken, `${workspace}:meta:user:${userId}`), state: 'connected',
    };
    if (name === 'finish_social_provider_revoke') return { id: grantId, state: 'disconnected' };
    return { ok: true };
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (!url.pathname.includes('/rest/v1/rpc/')) return new Response(body({ message: 'Unexpected request' }), { status: 500 });
      dbFetchCount++;
      const name = url.pathname.split('/').pop() ?? '';
      const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      rpcCalls.push({ name, args });
      return new Response(body(rpcHandler(name, args)), { headers: { 'Content-Type': 'application/json' } });
    } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
});

describe('Social connection API', () => {
  it('requires a signed-in user and does not access the database when unauthenticated', async () => {
    vi.mocked(getApiSession).mockResolvedValue({
      user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }),
    });
    expect((await GET(request('/api/social-marketing/connections'))).status).toBe(401);
    expect((await POST(request('/api/social-marketing/connections', { action: 'finish_selection' }))).status).toBe(401);
    expect((await startOAuth(request('/api/social-marketing/connections/oauth', {}))).status).toBe(401);
    expect(dbFetchCount).toBe(0);
  });

  it('lists safe account data and marks the response private', async () => {
    const response = await GET(request('/api/social-marketing/connections'));
    const result = await response.json() as { connections: Array<Record<string, unknown>>; grants: unknown[]; can_manage: boolean };
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(result.can_manage).toBe(true);
    expect(result.connections).toHaveLength(1);
    expect(result.grants).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('encrypted_user_token');
    expect(JSON.stringify(result)).not.toContain('encrypted_page_token');
    expect(JSON.stringify(result)).not.toContain(userToken);
    expect(JSON.stringify(result)).not.toContain(pageToken);
  });

  it('starts OAuth with hashed server state and a short-lived HttpOnly browser-binding cookie', async () => {
    const response = await startOAuth(request('/api/social-marketing/connections/oauth', {}));
    const result = await response.json() as { url: string };
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(response.status).toBe(200);
    expect(new URL(result.url).origin).toBe('https://www.facebook.com');
    expect(new URL(result.url).searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Max-Age=600');
    expect(rpcCalls[0].name).toBe('begin_social_oauth');
    expect(rpcCalls[0].args.p_state_hash).not.toBe(new URL(result.url).searchParams.get('state'));
    expect(String(rpcCalls[0].args.p_state_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(rpcCalls[0].args.p_actor).toBe(actor);
  });

  it('consumes callback state once and stores the access token only as an encrypted grant', async () => {
    const rawState = 'one-time-state-value-987654321';
    const browserBinding = 'browser-binding-value';
    const response = await completeOAuth(callbackRequest(`?code=one-time-code&state=${rawState}`, `crm-social-meta-state=${browserBinding}`));
    const store = rpcCalls.find((call) => call.name === 'store_social_oauth_grant');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://crm.invalid/communication/social?connection=ready');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(rpcCalls[0]).toEqual({
      name: 'consume_social_oauth_state',
      args: {
        p_actor: actor,
        p_state_hash: createHash('sha256').update(rawState).digest('hex'),
        p_browser_hash: createHash('sha256').update(browserBinding).digest('hex'),
      },
    });
    expect(vi.mocked(exchangeSocialMetaCode)).toHaveBeenCalledWith(
      'one-time-code', 'https://crm.invalid/api/social-marketing/connections/callback',
    );
    expect(store?.args.p_encrypted_user_token).not.toBe(userToken);
    expect(openSocialToken(String(store?.args.p_encrypted_user_token), `${workspace}:meta:user:${userId}`)).toBe(userToken);
    expect(response.headers.get('set-cookie')).toContain('crm-social-meta-grant=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/social-marketing/connections');
  });

  it('denies OAuth callbacks without the browser-bound cookie before database access', async () => {
    const response = await completeOAuth(callbackRequest('?code=one-time-code&state=state-without-cookie'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('state is missing') });
    expect(rpcCalls).toHaveLength(0);
    expect(vi.mocked(exchangeSocialMetaCode)).not.toHaveBeenCalled();
  });

  it('handles user-declined authorization without storing a grant', async () => {
    const response = await completeOAuth(callbackRequest('?error=access_denied&state=declined-state', stateCookie));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://crm.invalid/communication/social?connection=denied');
    expect(rpcCalls.some((call) => call.name === 'consume_social_oauth_state')).toBe(true);
    expect(rpcCalls.some((call) => call.name === 'store_social_oauth_grant')).toBe(false);
    expect(vi.mocked(exchangeSocialMetaCode)).not.toHaveBeenCalled();
  });

  it('verifies discovered account authorization before saving encrypted target credentials', async () => {
    const response = await POST(request('/api/social-marketing/connections', {
      action: 'select_page', page_id: pageId, include_instagram: true,
    }, oauthCookie));
    const save = rpcCalls.find((call) => call.name === 'save_social_provider_accounts');
    expect(response.status).toBe(200);
    expect(vi.mocked(discoverSocialMetaPages)).toHaveBeenCalledWith(userToken, scopes);
    expect(vi.mocked(getSocialMetaPage)).toHaveBeenCalledWith(userToken, pageId, scopes);
    expect(save?.args.p_actor).toBe(actor);
    const savedAccounts = save?.args.p_accounts as Array<Record<string, unknown>>;
    expect(savedAccounts).toHaveLength(2);
    const page = savedAccounts.find((account) => account.platform === 'facebook_page');
    expect(page?.external_account_id).toBe(pageId);
    expect(page?.encrypted_page_token).not.toBe(pageToken);
    expect(openSocialToken(String(page?.encrypted_page_token), `${workspace}:meta:page:${pageId}`)).toBe(pageToken);
    expect(JSON.stringify(save)).not.toContain(pageToken);
  });

  it('rejects a Page not returned by the authorized Meta login', async () => {
    const response = await POST(request('/api/social-marketing/connections', {
      action: 'select_page', page_id: '111111', include_instagram: false,
    }, oauthCookie));
    expect(response.status).toBe(403);
    expect(vi.mocked(getSocialMetaPage)).not.toHaveBeenCalled();
    expect(rpcCalls.some((call) => call.name === 'save_social_provider_accounts')).toBe(false);
  });

  it('rejects a linked Instagram account that changes between discovery and selection', async () => {
    vi.mocked(getSocialMetaPage).mockResolvedValue({
      id: pageId, name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'], access_token: pageToken,
      instagram_business_account: { id: '999999999', username: 'different-account' },
    });
    const response = await POST(request('/api/social-marketing/connections', {
      action: 'select_page', page_id: pageId, include_instagram: true,
    }, oauthCookie));
    expect(response.status).toBe(409);
    expect(vi.mocked(getSocialMetaPage)).toHaveBeenCalled();
    expect(rpcCalls.some((call) => call.name === 'save_social_provider_accounts')).toBe(false);
  });

  it('rejects malformed commands without making a provider or database command call', async () => {
    const response = await POST(request('/api/social-marketing/connections', {
      action: 'finish_selection', token: 'unexpected',
    }));
    expect(response.status).toBe(400);
    expect(vi.mocked(discoverSocialMetaPages)).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it('finishes account selection and expires its temporary grant cookie', async () => {
    const response = await POST(request('/api/social-marketing/connections', { action: 'finish_selection' }, oauthCookie));
    expect(response.status).toBe(200);
    expect(rpcCalls).toContainEqual({ name: 'finish_social_oauth_grant', args: { p_actor: actor, p_id: grantId } });
    expect(response.headers.get('set-cookie')).toContain('crm-social-meta-grant=');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/social-marketing/connections');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('records a failed remote revoke as pending while preventing further publishing', async () => {
    vi.mocked(revokeSocialMetaGrant).mockRejectedValue(new Error('provider response includes sensitive details'));
    rpcHandler = (name, args) => {
      if (name === 'load_social_provider_revoke') return {
        id: grantId, workspace_id: workspace, external_user_id: userId,
        encrypted_user_token: sealSocialToken(userToken, `${workspace}:meta:user:${userId}`), state: 'connected',
      };
      if (name === 'finish_social_provider_revoke') return { id: grantId, state: 'revocation_pending', ...args };
      return { ok: true };
    };
    const response = await POST(request('/api/social-marketing/connections', { action: 'revoke_grant', grant_id: grantId }));
    const result = await response.json() as { message: string };
    expect(response.status).toBe(503);
    expect(result.message).toContain('CRM publishing is disabled');
    expect(result.message).not.toContain(userToken);
    expect(result.message).not.toContain('sensitive details');
    expect(rpcCalls).toContainEqual(expect.objectContaining({
      name: 'finish_social_provider_revoke',
      args: expect.objectContaining({ p_actor: actor, p_grant_id: grantId, p_revoked: false }),
    }));
  });

  it('disables local use when a stored Meta token cannot be decrypted', async () => {
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ different: Buffer.alloc(32, 7).toString('base64') }));
    rpcHandler = (name, args) => {
      if (name === 'load_social_provider_revoke') return {
        id: grantId, workspace_id: workspace, external_user_id: userId,
        encrypted_user_token: 'missing-key-version.abc.def.ghi', state: 'connected',
      };
      if (name === 'finish_social_provider_revoke') return { id: grantId, state: 'revocation_pending', ...args };
      return { ok: true };
    };
    const response = await POST(request('/api/social-marketing/connections', { action: 'revoke_grant', grant_id: grantId }));
    expect(response.status).toBe(503);
    expect(vi.mocked(revokeSocialMetaGrant)).not.toHaveBeenCalled();
    expect(rpcCalls).toContainEqual(expect.objectContaining({
      name: 'finish_social_provider_revoke',
      args: expect.objectContaining({ p_actor: actor, p_grant_id: grantId, p_revoked: false }),
    }));
  });
});
