import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverSocialMetaPages, exchangeSocialMetaCode, revokeSocialMetaGrant, socialMetaAuthorizationUrl,
  socialMetaConfigurationIssues,
} from './social-meta-provider';

const userToken = 'user-token-with-enough-length-123456';
const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];
const requests: Array<{ url: URL; init?: RequestInit }> = [];
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function setResponse(responder: (url: URL, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return responder(url, init);
  }));
}
function config(): void {
  vi.stubEnv('SOCIAL_META_CONNECTIONS_ENABLED', 'true');
  vi.stubEnv('SOCIAL_META_CLIENT_ID', 'test-app-id');
  vi.stubEnv('SOCIAL_META_CLIENT_SECRET', 'server-only-app-secret');
  vi.stubEnv('SOCIAL_META_REDIRECT_URI', 'https://crm.invalid/api/social-marketing/connections/callback');
  vi.stubEnv('SOCIAL_META_GRAPH_API_VERSION', 'v27.0');
  vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'v1');
  vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
}

beforeEach(() => { requests.length = 0; config(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Meta provider adapter', () => {
  it('builds a pinned OAuth URL using a strong single-use state', () => {
    const url = new URL(socialMetaAuthorizationUrl('a'.repeat(43)));
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v27.0/dialog/oauth');
    expect(url.searchParams.get('state')).toBe('a'.repeat(43));
    expect(url.searchParams.get('redirect_uri')).toBe('https://crm.invalid/api/social-marketing/connections/callback');
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(url.searchParams.get('client_secret')).toBeNull();
    expect(() => socialMetaAuthorizationUrl('weak')).toThrow('state is invalid');
  });

  it('checks long-lived token, identity, and granted Page permissions before returning credentials', async () => {
    setResponse((url) => {
      if (url.pathname.endsWith('/oauth/access_token')) {
        return json({ access_token: url.searchParams.has('code') ? 'short-token-with-enough-length-123' : userToken, expires_in: 3600 });
      }
      if (url.pathname.endsWith('/me/permissions')) {
        return json({ data: scopes.map((permission) => ({ permission, status: 'granted' })) });
      }
      if (url.pathname.endsWith('/me')) return json({ id: '123456789', name: 'Agency Login' });
      return json({ error: { message: 'unexpected' } }, 400);
    });
    const result = await exchangeSocialMetaCode('authorization-code', 'https://crm.invalid/api/social-marketing/connections/callback');
    expect(result).toMatchObject({ accessToken: userToken, userId: '123456789', userName: 'Agency Login', scopes });
    expect(result.expiresAt).toMatch(/Z$/);
    expect(requests).toHaveLength(4);
    expect(requests.some(({ url }) => url.searchParams.get('client_secret') === 'server-only-app-secret')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('server-only-app-secret');
  });

  it('discovers only capability-ready accounts and never returns provider tokens', async () => {
    setResponse((url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${userToken}`);
      return json({ data: [{
        id: '12345', name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'],
        access_token: 'page-token-that-must-not-leak-123456',
        instagram_business_account: { id: '67890', username: 'agency' },
      }] });
    });
    const result = await discoverSocialMetaPages(userToken, scopes);
    expect(result).toEqual([{
      id: '12345', name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'],
      can_publish_facebook: true, facebook_block_reason: null,
      instagram_business_account: { id: '67890', username: 'agency' },
      can_publish_instagram: true, instagram_block_reason: null,
    }]);
    expect(JSON.stringify(result)).not.toContain('page-token-that-must-not-leak');
    expect(requests[0].url.searchParams.get('appsecret_proof')).toBeTruthy();
  });

  it('does not silently accept truncated or duplicate Page discovery', async () => {
    setResponse(() => json({ data: [], paging: { next: 'https://graph.facebook.com/next' } }));
    await expect(discoverSocialMetaPages(userToken, scopes)).rejects.toThrow('invalid pagination');
    requests.length = 0;
    setResponse(() => json({ data: [
      { id: '12345', name: 'Page A', tasks: ['CREATE_CONTENT'], access_token: 'page-token-123456789012345' },
      { id: '12345', name: 'Page A duplicate', tasks: ['CREATE_CONTENT'], access_token: 'page-token-123456789012345' },
    ] }));
    await expect(discoverSocialMetaPages(userToken, scopes)).rejects.toThrow('duplicate Page');
  });

  it('normalizes rate limits without returning provider error details', async () => {
    setResponse(() => json({ error: { message: 'secret response from provider' } }, 429));
    await expect(discoverSocialMetaPages(userToken, scopes)).rejects.toThrow('rate-limited');
  });

  it('confirms remote revocation and rejects incomplete encryption configuration', async () => {
    setResponse((_url, init) => {
      expect(init?.method).toBe('DELETE');
      return json({ success: true });
    });
    await expect(revokeSocialMetaGrant(userToken)).resolves.toBeUndefined();
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: 'invalid' }));
    expect(socialMetaConfigurationIssues()).toContain('SOCIAL_TOKEN_KEYS must contain the active version as a canonical base64-encoded 32-byte key.');
  });
});
