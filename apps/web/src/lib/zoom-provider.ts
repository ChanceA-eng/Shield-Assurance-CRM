import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeAgencyMember } from './agency-membership';
import { calendarCallbackUrl } from './google-calendar';
import { openGmailSecret, sealGmailSecret } from './gmail-provider';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';

export const ZOOM_SCOPES = [
  'user:read:user', 'meeting:read:list_meetings', 'meeting:read:meeting',
  'meeting:write:meeting', 'meeting:update:meeting', 'meeting:delete:meeting',
];
export interface ZoomConnection {
  user_id: string; email: string; status: 'connected' | 'reconnect' | 'disconnected'; last_error: string | null;
}
interface ZoomCredentials {
  refresh_secret: string; access_secret: string | null; access_expires_at: string | null;
}
export function zoomConfigured(): boolean {
  return Boolean(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}
export function zoomCallbackUrl(): URL {
  const url = new URL(process.env.ZOOM_OAUTH_REDIRECT_URI || new URL('/api/zoom/callback', calendarCallbackUrl().origin).href);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.pathname !== '/api/zoom/callback' || url.search || url.hash || url.username || url.password) {
    throw new WorkspaceError('The Zoom connection callback needs administrator correction.', 503);
  }
  return url;
}
export function zoomHasScopes(scope: string): boolean {
  const granted = new Set(scope.split(' '));
  return ZOOM_SCOPES.every((required) => granted.has(required));
}
export async function zoomTokens(params: URLSearchParams): Promise<{ access_token: string; refresh_token: string; expires_in: number; scope: string }> {
  if (!zoomConfigured()) throw new WorkspaceError('Zoom connection is not enabled yet. Contact your administrator.', 503);
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST', headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, body: params.toString(), signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new WorkspaceError('Zoom authorization could not be completed. Reconnect Zoom.', 503);
  const result: unknown = await response.json();
  if (!isRecord(result) || typeof result.access_token !== 'string' || !result.access_token
    || typeof result.refresh_token !== 'string' || !result.refresh_token || typeof result.scope !== 'string'
    || typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0
    || !zoomHasScopes(result.scope)) throw new WorkspaceError('Approve Zoom profile and meeting permissions, then reconnect.', 409);
  return { access_token: result.access_token, refresh_token: result.refresh_token, expires_in: result.expires_in, scope: result.scope };
}
export async function ownZoomConnection(db: SupabaseClient, actor: string): Promise<ZoomConnection | null> {
  await activeAgencyMember(db, actor);
  const found = await db.from('zoom_connections').select('user_id,email,status,last_error').eq('user_id', actor).maybeSingle<ZoomConnection>();
  if (found.error) throw databaseError(found.error);
  return found.data;
}
async function zoomAccessToken(db: SupabaseClient, actor: string): Promise<string> {
  if ((await ownZoomConnection(db, actor))?.status !== 'connected') throw new WorkspaceError('Connect your Zoom account before syncing Zoom appointments.', 409);
  const result = await db.from('zoom_credentials').select('refresh_secret,access_secret,access_expires_at').eq('user_id', actor).single<ZoomCredentials>();
  if (result.error) throw databaseError(result.error);
  const fresh = (row: ZoomCredentials) => row.access_secret && Date.parse(row.access_expires_at ?? '') > Date.now() + 60000;
  if (fresh(result.data)) return openGmailSecret(result.data.access_secret!, actor);
  // Zoom rotates refresh tokens. A database lease prevents concurrent refresh
  // requests from invalidating each other's new credentials.
  const lock = randomUUID();
  const claimed = await db.rpc('claim_zoom_refresh', { p_user: actor, p_lock: lock });
  if (claimed.error) throw databaseError(claimed.error);
  const credentials = claimed.data as ZoomCredentials;
  try {
    if (fresh(credentials)) return openGmailSecret(credentials.access_secret!, actor);
    let tokens;
    try { tokens = await zoomTokens(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: openGmailSecret(credentials.refresh_secret, actor) })); }
    catch {
      const failed = await db.from('zoom_connections').update({ status: 'reconnect', last_error: 'Zoom authorization needs reconnecting.' }).eq('user_id', actor);
      if (failed.error) throw databaseError(failed.error);
      throw new WorkspaceError('Reconnect Zoom before retrying appointment sync.', 503);
    }
    const saved = await db.from('zoom_credentials').update({
      refresh_secret: sealGmailSecret(tokens.refresh_token, actor), access_secret: sealGmailSecret(tokens.access_token, actor),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }).eq('user_id', actor).eq('refresh_lock', lock).gt('refresh_lease_until', new Date().toISOString()).select('user_id').maybeSingle();
    if (saved.error) throw databaseError(saved.error);
    if (!saved.data) throw new WorkspaceError('Zoom authorization changed. Reconnect before retrying.', 409);
    return tokens.access_token;
  } finally {
    const release = await db.from('zoom_credentials').update({ refresh_lock: null, refresh_lease_until: null }).eq('user_id', actor).eq('refresh_lock', lock);
    if (release.error) console.error('[zoom/refresh-lease]', release.error.code);
  }
}
export class ZoomHttpError extends WorkspaceError {
  constructor(public readonly providerStatus: number) {
    super(providerStatus === 401 ? 'Reconnect Zoom before retrying appointment sync.'
      : `Zoom update failed (HTTP ${providerStatus}). Your appointment is saved; retry sync.`, 503);
  }
}
export async function zoomTokenRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new WorkspaceError('Invalid Zoom API path.', 400);
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new ZoomHttpError(response.status);
  return response.status === 204 ? null : response.json();
}
export async function zoomAuthorizedRequest(db: SupabaseClient, actor: string): Promise<(path: string, init?: RequestInit) => Promise<unknown>> {
  const token = await zoomAccessToken(db, actor);
  return async (path, init) => {
    try { return await zoomTokenRequest(token, path, init); }
    catch (error) {
      if (error instanceof ZoomHttpError && error.providerStatus === 401) {
        const result = await db.from('zoom_connections').update({ status: 'reconnect', last_error: 'Reconnect Zoom.' }).eq('user_id', actor);
        if (result.error) throw databaseError(result.error);
      }
      throw error;
    }
  };
}
