import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openGmailSecret, sealGmailSecret } from './gmail-provider';
import { activeAgencyMember } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';

export const CALENDAR_SCOPES = [
  'openid', 'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
export interface CalendarConnection {
  user_id: string; email: string; status: 'connected' | 'reconnect' | 'disconnected'; last_error: string | null;
}
export function calendarCallbackUrl(): URL {
  const uri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (!uri) throw new WorkspaceError('Configure the existing Google OAuth web client first.', 503);
  const url = new URL(uri);
  if ((url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    || !url.pathname.endsWith('/gmail/callback') || url.search || url.hash) {
    throw new WorkspaceError('Configure a canonical Gmail OAuth callback ending in /gmail/callback.', 503);
  }
  url.pathname = url.pathname.replace(/\/gmail\/callback$/, '/google-calendar/callback');
  return url;
}
export function calendarOAuthClient(): OAuth2Client {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new WorkspaceError('Google OAuth is not configured.', 503);
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: calendarCallbackUrl().href, transporterOptions: { timeout: 15000 },
  });
}
export function calendarStateHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function calendarHasScopes(scope: string | null | undefined): boolean {
  const granted = new Set((scope ?? '').split(' '));
  return CALENDAR_SCOPES.every((required) => granted.has(required));
}
export async function ownCalendarConnection(db: SupabaseClient, userId: string): Promise<CalendarConnection | null> {
  await activeAgencyMember(db, userId);
  const result = await db.from('google_calendar_connections').select('user_id,email,status,last_error').eq('user_id', userId).maybeSingle<CalendarConnection>();
  if (result.error) throw databaseError(result.error);
  return result.data;
}
async function calendarAccessToken(db: SupabaseClient, userId: string): Promise<string> {
  const connection = await ownCalendarConnection(db, userId);
  if (connection?.status !== 'connected') throw new WorkspaceError('Connect your Google Calendar before scheduling Google Meet or calendar syncing.', 409);
  const result = await db.from('google_calendar_credentials').select('refresh_secret,access_secret,access_expires_at').eq('user_id', userId).single();
  if (result.error) throw databaseError(result.error);
  if (result.data.access_secret && Date.parse(result.data.access_expires_at ?? '') > Date.now() + 60000) {
    return openGmailSecret(result.data.access_secret, userId);
  }
  const client = calendarOAuthClient();
  client.setCredentials({ refresh_token: openGmailSecret(result.data.refresh_secret, userId) });
  let tokens;
  try { tokens = (await client.refreshAccessToken()).credentials; }
  catch (error) {
    const invalid = isRecord(error) && isRecord(error.response) && isRecord(error.response.data) && error.response.data.error === 'invalid_grant';
    if (invalid) {
      const saved = await db.from('google_calendar_connections').update({ status: 'reconnect', last_error: 'Google Calendar authorization expired. Reconnect Calendar.' }).eq('user_id', userId);
      if (saved.error) throw databaseError(saved.error);
    }
    throw new WorkspaceError(invalid ? 'Reconnect Google Calendar.' : 'Google Calendar authorization is temporarily unavailable. Retry the calendar sync.', 503);
  }
  if (!tokens.access_token) throw new WorkspaceError('Google Calendar did not return authorization. Reconnect Calendar.', 503);
  const saved = await db.from('google_calendar_credentials').update({
    access_secret: sealGmailSecret(tokens.access_token, userId),
    access_expires_at: new Date(tokens.expiry_date ?? Date.now() + 300000).toISOString(),
    ...(tokens.refresh_token ? { refresh_secret: sealGmailSecret(tokens.refresh_token, userId) } : {}),
  }).eq('user_id', userId).eq('refresh_secret', result.data.refresh_secret);
  if (saved.error) throw databaseError(saved.error);
  return tokens.access_token;
}
export class CalendarHttpError extends WorkspaceError {
  constructor(public readonly providerStatus: number) {
    super(`Google Calendar request failed (HTTP ${providerStatus}). ${providerStatus === 401 ? 'Reconnect Calendar.' : 'Retry calendar sync; the appointment is retained.'}`, 503);
  }
}
export async function calendarRequest(db: SupabaseClient, userId: string, path: string, init?: RequestInit): Promise<unknown> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new WorkspaceError('Invalid Calendar API path.', 400);
  const token = await calendarAccessToken(db, userId);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new CalendarHttpError(response.status);
  return response.status === 204 ? null : response.json();
}
export interface BusyInterval { start: string; end: string }
export async function calendarBusy(db: SupabaseClient, userId: string, start: string, end: string, excludeGoogleId?: string): Promise<BusyInterval[]> {
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)
    || Date.parse(end) - Date.parse(start) > 31 * 86400000) throw new WorkspaceError('Choose a valid Calendar range of at most 31 days.', 400);
  if (excludeGoogleId) {
    // Free/busy does not identify events, so an update uses the equivalent event
    // window to exclude only this appointment, not every overlapping busy block.
    const busy: BusyInterval[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: 'true', maxResults: '2500' });
      if (page) params.set('pageToken', page);
      const result = await calendarRequest(db, userId, `/calendars/primary/events?${params}`);
      if (!isRecord(result) || !Array.isArray(result.items)) throw new WorkspaceError('Google Calendar availability could not be verified.', 503);
      for (const event of result.items) {
        if (!isRecord(event) || event.id === excludeGoogleId || event.status === 'cancelled' || event.transparency === 'transparent') continue;
        if (!isRecord(event.start) || !isRecord(event.end)) throw new WorkspaceError('Google Calendar returned incomplete availability.', 503);
        const from = event.start.dateTime ?? event.start.date, to = event.end.dateTime ?? event.end.date;
        if (typeof from !== 'string' || typeof to !== 'string') throw new WorkspaceError('Google Calendar returned incomplete availability.', 503);
        busy.push({ start: from, end: to });
      }
      page = typeof result.nextPageToken === 'string' ? result.nextPageToken : undefined;
    } while (page);
    return busy;
  }
  const result = await calendarRequest(db, userId, '/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: start, timeMax: end, items: [{ id: 'primary' }] }) });
  const primary = isRecord(result) && isRecord(result.calendars) ? result.calendars.primary : null;
  if (!isRecord(primary) || (Array.isArray(primary.errors) && primary.errors.length) || !Array.isArray(primary.busy)) {
    throw new WorkspaceError('Google Calendar availability could not be verified. No appointment was changed.', 503);
  }
  return primary.busy.map((item: unknown) => {
    if (!isRecord(item) || typeof item.start !== 'string' || typeof item.end !== 'string') throw new WorkspaceError('Google Calendar returned invalid availability.', 503);
    return { start: item.start, end: item.end };
  });
}
export function newManageToken(): string { return randomBytes(32).toString('base64url'); }
