import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GmailConnectionStatus } from '@crm/shared';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { activeAgencyMember } from './agency-membership';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
export const GMAIL_SEND_ONLY_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'];
export interface GmailConnection extends GmailConnectionStatus { user_id: string; history_id: string | null; sync_enabled: boolean }

export function assertGmailEnabled(): void {
  if (process.env.CRM_GMAIL_ENABLED !== 'true') {
    throw new WorkspaceError('Gmail sending is not enabled. Ask your administrator to configure CRM_GMAIL_ENABLED.', 503);
  }
}

function tokenKey(version: string): Buffer {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version)) throw new WorkspaceError('Configure a valid Gmail encryption key version.', 503);
  let keys: unknown;
  try { keys = JSON.parse(process.env.GMAIL_TOKEN_KEYS ?? '{}'); }
  catch { throw new WorkspaceError('Gmail token keyring JSON is invalid.', 503); }
  if (!isRecord(keys) || typeof keys[version] !== 'string') throw new WorkspaceError('Gmail token encryption is not configured.', 503);
  const key = Buffer.from(keys[version], 'base64');
  if (key.length !== 32) throw new WorkspaceError('Gmail encryption keys must contain 32 bytes.', 503);
  return key;
}

export function sealGmailSecret(value: string, userId: string): string {
  const version = process.env.GMAIL_TOKEN_KEY_VERSION ?? '';
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(version), nonce);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [version, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function openGmailSecret(value: string, userId: string): string {
  const [version, nonce, tag, encrypted, extra] = value.split('.');
  if (!version || !nonce || !tag || !encrypted || extra) throw new WorkspaceError('Stored Gmail authorization is invalid. Reconnect Gmail.', 503);
  if (Buffer.from(nonce, 'base64url').length !== 12 || Buffer.from(tag, 'base64url').length !== 16) throw new WorkspaceError('Stored Gmail authorization is invalid. Reconnect Gmail.', 503);
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(version), Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  try { return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'); }
  catch { throw new WorkspaceError('Gmail authorization cannot be decrypted. Reconnect Gmail.', 503); }
}

export function googleOAuthClient(): OAuth2Client {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redirect) throw new WorkspaceError('Google OAuth web-client setup is incomplete.', 503);
  const url = new URL(redirect);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new WorkspaceError('Gmail OAuth requires an HTTPS callback.', 503);
  }
  return new OAuth2Client({ clientId: id, clientSecret: secret, redirectUri: redirect, transporterOptions: { timeout: 15000 } });
}

export async function getOwnGmailConnection(db: SupabaseClient, userId: string): Promise<GmailConnection | null> {
  assertGmailEnabled();
  await activeAgencyMember(db, userId);
  const { data, error } = await db.from('gmail_connections')
    .select('id,user_id,email,status,last_sync_at,last_error,watch_expires_at,bootstrap_complete,history_id,sync_enabled')
    .eq('user_id', userId).maybeSingle<GmailConnection>();
  if (error) throw databaseError(error);
  return data;
}

export async function loadGmailConnection(db: SupabaseClient, connectionId: string): Promise<GmailConnection> {
  assertGmailEnabled();
  const { data, error } = await db.from('gmail_connections')
    .select('id,user_id,email,status,last_sync_at,last_error,watch_expires_at,bootstrap_complete,history_id,sync_enabled')
    .eq('id', connectionId).single<GmailConnection>();
  if (error) throw databaseError(error);
  if (data.status !== 'connected') throw new WorkspaceError('Reconnect this Gmail mailbox before sending or syncing.', 409);
  await activeAgencyMember(db, data.user_id);
  return data;
}

async function gmailToken(db: SupabaseClient, connection: GmailConnection): Promise<string> {
  const owner = randomUUID();
  const { data: locked, error: lockError } = await db.rpc('claim_gmail_token', { p_connection_id: connection.id, p_lock: owner });
  if (lockError) throw databaseError(lockError);
  if (!locked) throw new WorkspaceError('Gmail authorization is refreshing. Retry shortly.', 409);
  try {
    const { data, error } = await db.from('gmail_tokens').select('refresh_secret,access_secret,access_expires_at').eq('connection_id', connection.id).single();
    if (error) throw databaseError(error);
    if (data.access_secret && Date.parse(data.access_expires_at ?? '') > Date.now() + 60000) {
      return openGmailSecret(data.access_secret, connection.user_id);
    }
    const client = googleOAuthClient();
    client.setCredentials({ refresh_token: openGmailSecret(data.refresh_secret, connection.user_id) });
    let tokens;
    try { tokens = (await client.refreshAccessToken()).credentials; }
    catch (error) {
      const response = isRecord(error) && isRecord(error.response) ? error.response : {};
      const invalid = isRecord(response.data) && response.data.error === 'invalid_grant';
      if (invalid) {
        const state = await db.from('gmail_connections').update({ status: 'reconnect', last_error: 'Google authorization expired or was revoked. Reconnect Gmail.' }).eq('id', connection.id);
        if (state.error) throw databaseError(state.error);
      }
      throw new WorkspaceError(invalid ? 'Gmail authorization was revoked. Reconnect Gmail.' : 'Google token refresh is temporarily unavailable. Retry shortly; no message was sent.', 503);
    }
    if (!tokens.access_token) throw new WorkspaceError('Google did not return an access token.', 503);
    const saved = await db.from('gmail_tokens').update({
      access_secret: sealGmailSecret(tokens.access_token, connection.user_id),
      access_expires_at: new Date(tokens.expiry_date ?? Date.now() + 300000).toISOString(),
      ...(tokens.refresh_token ? { refresh_secret: sealGmailSecret(tokens.refresh_token, connection.user_id) } : {}),
    }).eq('connection_id', connection.id).eq('token_lock', owner).gt('token_lease_until', new Date().toISOString()).select('connection_id').single();
    if (saved.error) throw databaseError(saved.error);
    return tokens.access_token;
  } finally {
    const released = await db.from('gmail_tokens').update({ token_lock: null, token_lease_until: null }).eq('connection_id', connection.id).eq('token_lock', owner);
    if (released.error) throw databaseError(released.error);
  }
}

export class GmailHttpError extends WorkspaceError {
  constructor(public readonly providerStatus: number) {
    super(`Gmail request failed (HTTP ${providerStatus}). ${providerStatus === 401 ? 'Reconnect Gmail.' : 'Check connection health before retrying.'}`, providerStatus === 404 ? 404 : 503);
  }
}

export async function gmailRequest(db: SupabaseClient, connectionId: string, path: string, init?: RequestInit): Promise<unknown> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new WorkspaceError('Invalid Gmail API path.', 400);
  const connection = await loadGmailConnection(db, connectionId);
  const token = await gmailToken(db, connection);
  await loadGmailConnection(db, connectionId);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new GmailHttpError(response.status);
  if (response.status === 204) return null;
  try { return await response.json(); }
  catch { throw new WorkspaceError('Gmail returned an invalid response. Check connection health before retrying.', 503); }
}

export function oauthStateHash(state: string): string { return createHash('sha256').update(state).digest('hex'); }
