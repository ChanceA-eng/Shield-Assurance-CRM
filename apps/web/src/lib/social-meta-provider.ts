import { createHmac } from 'node:crypto';
import type { SocialDiscoveredAccount } from '@crm/shared';
import { validateSocialTokenConfiguration } from '@crm/shared/social-token-crypto';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';

const REQUIRED_FACEBOOK_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] as const;
const REQUIRED_INSTAGRAM_SCOPES = ['instagram_basic', 'instagram_content_publish'] as const;
const OPTIONAL_PERMISSIONS = [...REQUIRED_FACEBOOK_SCOPES, ...REQUIRED_INSTAGRAM_SCOPES];
const META_COOKIE_STATE = 'crm-social-meta-state';
const META_COOKIE_GRANT = 'crm-social-meta-grant';
const ID_PATTERN = /^\d{1,32}$/;

interface MetaConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
}
export interface MetaOAuthGrant {
  accessToken: string;
  expiresAt: string;
  userId: string;
  userName: string;
  scopes: string[];
}
interface MetaPage {
  id: string;
  name: string;
  category: string | null;
  tasks: string[];
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}
interface MetaPageResponse { data: MetaPage[]; paging?: { cursors?: { after?: string }; next?: string } }

export function socialMetaCookieNames(): { state: string; grant: string } {
  return { state: META_COOKIE_STATE, grant: META_COOKIE_GRANT };
}

export function socialMetaConfigurationIssues(): string[] {
  const issues: string[] = [];
  if (process.env.SOCIAL_META_CONNECTIONS_ENABLED !== 'true') issues.push('Set SOCIAL_META_CONNECTIONS_ENABLED=true after the provider application is configured and reviewed.');
  for (const key of ['SOCIAL_META_CLIENT_ID','SOCIAL_META_CLIENT_SECRET','SOCIAL_META_REDIRECT_URI','SOCIAL_META_GRAPH_API_VERSION',
    'SOCIAL_TOKEN_KEY_VERSION','SOCIAL_TOKEN_KEYS']) {
    if (!process.env[key]?.trim()) issues.push(`Configure ${key} in the server and worker environment.`);
  }
  const redirect = process.env.SOCIAL_META_REDIRECT_URI;
  if (redirect) {
    try {
      const callback = new URL(redirect);
      if (!(callback.protocol === 'https:' || (callback.protocol === 'http:' && ['localhost','127.0.0.1'].includes(callback.hostname)))
        || callback.search || callback.hash || !callback.pathname.endsWith('/api/social-marketing/connections/callback')) {
        issues.push('SOCIAL_META_REDIRECT_URI must be an HTTPS callback to /api/social-marketing/connections/callback.');
      }
    } catch { issues.push('SOCIAL_META_REDIRECT_URI must be a valid HTTPS callback URL.'); }
  }
  if (process.env.SOCIAL_META_GRAPH_API_VERSION && !/^v\d{1,3}\.\d{1,2}$/.test(process.env.SOCIAL_META_GRAPH_API_VERSION)) {
    issues.push('SOCIAL_META_GRAPH_API_VERSION must be a pinned version such as v27.0.');
  }
  if (process.env.SOCIAL_TOKEN_KEY_VERSION?.trim() && process.env.SOCIAL_TOKEN_KEYS?.trim()) {
    try { validateSocialTokenConfiguration(); }
    catch { issues.push('SOCIAL_TOKEN_KEYS must contain the active version as a canonical base64-encoded 32-byte key.'); }
  }
  return issues;
}

function metaConfig(): MetaConfig {
  const issues = socialMetaConfigurationIssues();
  if (issues.length) throw new WorkspaceError(issues.join(' '), 503);
  return {
    appId: process.env.SOCIAL_META_CLIENT_ID!,
    appSecret: process.env.SOCIAL_META_CLIENT_SECRET!,
    redirectUri: process.env.SOCIAL_META_REDIRECT_URI!,
    graphVersion: process.env.SOCIAL_META_GRAPH_API_VERSION!,
  };
}

export function socialMetaAuthorizationUrl(state: string): string {
  const config = metaConfig();
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new WorkspaceError('Meta authorization state is invalid. Start again.', 400);
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', OPTIONAL_PERMISSIONS.join(','));
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
}

function appSecretProof(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('hex');
}

async function graphRequest<T>(path: string, token: string, parameters: Record<string, string> = {}): Promise<T> {
  const config = metaConfig();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new WorkspaceError('Invalid Meta API request.', 400);
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  url.searchParams.set('appsecret_proof', appSecretProof(token, config.appSecret));
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new WorkspaceError('Meta could not be reached. Retry the connection check; credentials were not changed.', 503);
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new WorkspaceError('Meta returned an invalid response. Retry the connection check.', 503); }
  if (!response.ok || !isRecord(body) || isRecord(body.error)) {
    if (response.status === 401 || response.status === 403) throw new WorkspaceError('Meta authorization is expired or missing permissions. Reconnect and approve the requested permissions.', 409);
    if (response.status === 429) throw new WorkspaceError('Meta rate-limited account discovery. Wait and try again.', 429);
    throw new WorkspaceError('Meta account discovery failed. Check the CRM provider configuration and try again.', 503);
  }
  return body as T;
}

function tokenResult(value: unknown): { accessToken: string; expiresAt: string } {
  if (!isRecord(value) || typeof value.access_token !== 'string' || value.access_token.length < 20
    || value.access_token.length > 20000 || typeof value.expires_in !== 'number'
    || !Number.isInteger(value.expires_in) || value.expires_in < 300 || value.expires_in > 120 * 24 * 60 * 60) {
    throw new WorkspaceError('Meta returned an invalid or short-lived access token. Reconnect and retry.', 503);
  }
  return { accessToken: value.access_token, expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString() };
}

async function exchangeToken(parameters: Record<string, string>): Promise<unknown> {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
  catch { throw new WorkspaceError('Meta token exchange failed. Start authorization again.', 503); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new WorkspaceError('Meta token exchange returned an invalid response.', 503); }
  if (!response.ok || !isRecord(body) || typeof body.access_token !== 'string') {
    throw new WorkspaceError('Meta authorization could not be completed. Start again and approve the requested permissions.', 400);
  }
  return body;
}

function permissionNames(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new WorkspaceError('Meta permission status could not be verified.', 503);
  return value.data.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.status === 'granted' && typeof entry.permission === 'string')
    .map((entry) => entry.permission as string);
}

export async function exchangeSocialMetaCode(code: string, redirectUri: string): Promise<MetaOAuthGrant> {
  const config = metaConfig();
  if (!code || code.length > 4096 || redirectUri !== config.redirectUri) throw new WorkspaceError('Meta authorization response was invalid. Start again.', 400);
  const short = tokenResult(await exchangeToken({
    client_id: config.appId, client_secret: config.appSecret, redirect_uri: redirectUri, code,
  }));
  const longRaw = await exchangeToken({
    grant_type: 'fb_exchange_token', client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: short.accessToken,
  });
  const long = tokenResult(longRaw);
  const identity = await graphRequest<{ id: string; name?: string }>('/me', long.accessToken, { fields: 'id,name' });
  if (!ID_PATTERN.test(identity.id) || typeof identity.name !== 'string' || !identity.name.trim() || identity.name.length > 200) {
    throw new WorkspaceError('Meta did not return a valid business identity.', 503);
  }
  const scopes = permissionNames(await graphRequest<unknown>('/me/permissions', long.accessToken));
  if (!REQUIRED_FACEBOOK_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new WorkspaceError('Approve Page discovery, Page engagement, and Page publishing permissions, then reconnect.', 403);
  }
  return { accessToken: long.accessToken, expiresAt: long.expiresAt, userId: identity.id, userName: identity.name.trim(), scopes };
}

function parsePage(value: unknown): MetaPage {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
    || typeof value.access_token !== 'string' || value.access_token.length < 20 || value.access_token.length > 20000
    || !Array.isArray(value.tasks) || value.tasks.length > 30
    || value.tasks.some((task) => typeof task !== 'string' || task.length > 80)) {
    throw new WorkspaceError('Meta returned an invalid Page record. Refresh discovery or reconnect.', 503);
  }
  let instagram_business_account: MetaPage['instagram_business_account'];
  if (value.instagram_business_account !== undefined && value.instagram_business_account !== null) {
    if (!isRecord(value.instagram_business_account) || typeof value.instagram_business_account.id !== 'string'
      || !ID_PATTERN.test(value.instagram_business_account.id)
      || (value.instagram_business_account.username !== undefined && typeof value.instagram_business_account.username !== 'string')) {
      throw new WorkspaceError('Meta returned an invalid linked Instagram account. Refresh discovery.', 503);
    }
    instagram_business_account = {
      id: value.instagram_business_account.id,
      username: typeof value.instagram_business_account.username === 'string' ? value.instagram_business_account.username.slice(0,100) : undefined,
    };
  }
  return {
    id: value.id, name: value.name.trim(), category: typeof value.category === 'string' ? value.category.slice(0,100) : null,
    tasks: value.tasks as string[], access_token: value.access_token, instagram_business_account,
  };
}

export async function discoverSocialMetaPages(userToken: string, scopes: string[]): Promise<SocialDiscoveredAccount[]> {
  const config = metaConfig();
  const accounts: SocialDiscoveredAccount[] = [];
  const accountIds = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const parameters: Record<string,string> = {
      fields: 'id,name,category,tasks,access_token,instagram_business_account{id,username}', limit: '100',
    };
    if (after) parameters.after = after;
    const result = await graphRequest<MetaPageResponse>('/me/accounts', userToken, parameters);
    if (!isRecord(result) || !Array.isArray(result.data) || result.data.length > 100) {
      throw new WorkspaceError('Meta Page discovery returned an invalid response.', 503);
    }
    for (const raw of result.data) {
      const account = parsePage(raw);
      if (accountIds.has(account.id)) throw new WorkspaceError('Meta returned a duplicate Page. Refresh discovery and try again.', 503);
      accountIds.add(account.id);
      const pageRole = account.tasks.includes('CREATE_CONTENT') || account.tasks.includes('MANAGE');
      const canPublishFacebook = scopes.includes('pages_manage_posts') && pageRole;
      const instagram = account.instagram_business_account ?? null;
      const hasInstagramScopes = REQUIRED_INSTAGRAM_SCOPES.every((scope) => scopes.includes(scope));
      const canPublishInstagram = Boolean(instagram && hasInstagramScopes && scopes.includes('pages_read_engagement'));
      accounts.push({
        id: account.id, name: account.name, category: account.category, tasks: account.tasks,
        can_publish_facebook: canPublishFacebook,
        facebook_block_reason: canPublishFacebook ? null : !scopes.includes('pages_manage_posts')
          ? 'Reconnect and approve Page publishing.' : 'Your Meta account needs the Page Create Content or Manage task.',
        instagram_business_account: instagram ? {
          id: instagram.id,
          username: instagram.username ?? null,
        } : null,
        can_publish_instagram: canPublishInstagram,
        instagram_block_reason: canPublishInstagram ? null : !instagram
          ? 'Link a professional Instagram account to this Facebook Page.'
          : 'Reconnect and approve Instagram Basic and Content Publishing permissions.',
      });
    }
    if (result.paging !== undefined && !isRecord(result.paging)) throw new WorkspaceError('Meta Page discovery returned invalid pagination.', 503);
    const next = result.paging?.next;
    if (next === undefined || next === null || next === '') return accounts;
    const cursor = result.paging?.cursors?.after;
    if (typeof next !== 'string' || typeof cursor !== 'string' || !cursor) {
      throw new WorkspaceError('Meta Page discovery returned invalid pagination.', 503);
    }
    if (cursor.length > 500) throw new WorkspaceError('Meta returned an invalid Page discovery cursor.', 503);
    after = cursor;
    if (page === 19) throw new WorkspaceError('More than 2,000 Pages were returned. Narrow the Meta business permissions before connecting.', 400);
  }
  return accounts;
}

export async function getSocialMetaPage(userToken: string, pageId: string, scopes: string[]): Promise<MetaPage> {
  if (!ID_PATTERN.test(pageId)) throw new WorkspaceError('Select a valid Facebook Page.', 400);
  let after: string | undefined;
  let page: MetaPage | undefined;
  for (let batch = 0; batch < 20; batch++) {
    const parameters: Record<string,string> = {
      fields: 'id,name,category,tasks,access_token,instagram_business_account{id,username}', limit: '100',
    };
    if (after) parameters.after = after;
    const result = await graphRequest<MetaPageResponse>('/me/accounts', userToken, parameters);
    if (!Array.isArray(result.data) || result.data.length > 100) throw new WorkspaceError('Meta Page discovery returned an invalid response.', 503);
    page = result.data.map(parsePage).find((candidate) => candidate.id === pageId);
    if (page) break;
    if (result.paging !== undefined && !isRecord(result.paging)) throw new WorkspaceError('Meta Page discovery returned invalid pagination.', 503);
    const next = result.paging?.next;
    if (next === undefined || next === null || next === '') break;
    const cursor = result.paging?.cursors?.after;
    if (typeof next !== 'string' || typeof cursor !== 'string' || !cursor) {
      throw new WorkspaceError('Meta Page discovery returned invalid pagination.', 503);
    }
    if (cursor.length > 500) throw new WorkspaceError('Meta returned an invalid Page discovery cursor.', 503);
    after = cursor;
    if (batch === 19) throw new WorkspaceError('More than 2,000 Pages were returned. Narrow the Meta business permissions before connecting.', 400);
  }
  if (!page) throw new WorkspaceError('That Facebook Page is not authorized by this Meta login. Refresh the list.', 403);
  const tasks = page.tasks;
  if (!scopes.includes('pages_manage_posts') || !(tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE'))) {
    throw new WorkspaceError('This Page is not authorized for publishing. Ask the Page owner to grant the Create Content task and reconnect.', 403);
  }
  return page;
}

export async function revokeSocialMetaGrant(userToken: string): Promise<void> {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me/permissions`);
  url.searchParams.set('appsecret_proof', appSecretProof(userToken, config.appSecret));
  let response: Response;
  try {
    response = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch { throw new WorkspaceError('Meta revocation could not be confirmed. CRM publishing is disabled; retry revocation or remove this app in Meta settings.', 503); }
  let result: unknown;
  try { result = await response.json(); } catch { throw new WorkspaceError('Meta revocation could not be confirmed. CRM publishing is disabled; retry revocation or remove this app in Meta settings.', 503); }
  if (!response.ok || !isRecord(result) || result.success !== true) {
    throw new WorkspaceError('Meta revocation could not be confirmed. CRM publishing is disabled; retry revocation or remove this app in Meta settings.', 503);
  }
}

export const SOCIAL_META_SCOPES = OPTIONAL_PERMISSIONS;
