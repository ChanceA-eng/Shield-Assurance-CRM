import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';

export async function readPendingEmailChanges(db: SupabaseClient): Promise<EmailChange[]> {
  const result = await db.from('account_email_changes').select('id,user_id,old_email,new_email,status,expires_at,created_at')
    .eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at').limit(100).returns<EmailChange[]>();
  if (result.error) throw databaseError(result.error);
  return result.data;
}

export interface EmailChange {
  id: string; user_id: string; old_email: string; new_email: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
  expires_at: string; created_at: string;
}

export function accountAuthClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new WorkspaceError('Account authentication is unavailable.', 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function securityLimit(db: SupabaseClient, purpose: string, subject: string, limit = 5): Promise<void> {
  const result = await db.rpc('reserve_account_security', {
    p_key: createHash('sha256').update(`${purpose}:${subject.toLowerCase()}`).digest('hex'), p_limit: limit,
  });
  if (result.error) throw databaseError(result.error);
  if (result.data !== true) throw new WorkspaceError('Too many attempts. Try again in an hour.', 429);
}

export async function reauthenticate(db: SupabaseClient, user: User, password: unknown): Promise<void> {
  await securityLimit(db, 'reauthenticate', user.id, 10);
  if (typeof password !== 'string' || !password || !user.email) throw new WorkspaceError('Enter your current password.', 400);
  const client = accountAuthClient();
  const result = await client.auth.signInWithPassword({ email: user.email, password });
  if (result.error || result.data.user?.id !== user.id) throw new WorkspaceError('Your current password was not verified.', 403);
  if (result.data.session) {
    const signedOut = await client.auth.signOut({ scope: 'local' });
    if (signedOut.error) {
      console.error('[account/reauthenticate] Temporary session cleanup failed', signedOut.error.code);
      throw new WorkspaceError('Password verification could not finish. Retry.', 503);
    }
  }
}

export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new WorkspaceError('Use at least 12 characters, up to 72 UTF-8 bytes.', 400);
  }
}

export function accountOrigin(): string {
  const origin = process.env.CRM_WEB_ORIGIN;
  if (!origin) throw new WorkspaceError('Requires deployment configuration: set CRM_WEB_ORIGIN.', 503);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new WorkspaceError('CRM_WEB_ORIGIN must be the HTTPS CRM address.', 503);
  return url.origin;
}

export function recoveryProof(userId: string, sessionToken: string, expires = Date.now() + 15 * 60 * 1000): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new WorkspaceError('Account recovery is unavailable.', 503);
  const value = `${userId}:${createHash('sha256').update(sessionToken).digest('hex')}:${expires}`;
  return `${value}:${createHmac('sha256', key).update(value).digest('hex')}`;
}

export function validRecoveryProof(value: string | undefined, userId: string, sessionToken: string): boolean {
  if (!value) return false;
  const [subject, session, expires, signature, extra] = value.split(':');
  if (extra !== undefined || subject !== userId || session !== createHash('sha256').update(sessionToken).digest('hex')
    || !expires || !signature || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return false;
  const expected = recoveryProof(userId, sessionToken, Number(expires)).split(':')[3];
  const supplied = Buffer.from(signature);
  const actual = Buffer.from(expected);
  return supplied.length === actual.length && timingSafeEqual(supplied, actual);
}
