import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { openGmailSecret, sealGmailSecret } from '../../../../lib/gmail-provider';
import { calendarCallbackUrl, calendarHasScopes, calendarOAuthClient, calendarStateHash } from '../../../../lib/google-calendar';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await activeAgencyMember(db, session.user.id);
    const state = request.nextUrl.searchParams.get('state') ?? '', browser = request.cookies.get('crm-calendar-oauth')?.value ?? '';
    const code = request.nextUrl.searchParams.get('code');
    if (!state || !browser || !code || request.nextUrl.searchParams.has('error')) throw new WorkspaceError('Calendar authorization was denied or incomplete. Connect again.', 400);
    const claimed = await db.from('google_calendar_oauth_states').delete()
      .eq('state_hash', calendarStateHash(state)).eq('browser_hash', calendarStateHash(browser)).eq('user_id', session.user.id)
      .gt('expires_at', new Date().toISOString()).select('verifier_secret').maybeSingle();
    if (claimed.error) throw databaseError(claimed.error);
    if (!claimed.data) throw new WorkspaceError('Calendar authorization expired, changed, or was already used. Connect again.', 400);
    const client = calendarOAuthClient();
    let tokens;
    try { tokens = (await client.getToken({ code, codeVerifier: openGmailSecret(claimed.data.verifier_secret, session.user.id) })).tokens; }
    catch { throw new WorkspaceError('Google Calendar authorization could not be completed. Connect again.', 400); }
    if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !calendarHasScopes(tokens.scope)) {
      throw new WorkspaceError('Approve Calendar event and availability permissions, identity, and offline access. Gmail permissions are unchanged.', 400);
    }
    let identity;
    try { identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID })).getPayload(); }
    catch { throw new WorkspaceError('Google Calendar account identity could not be verified.', 400); }
    if (identity?.email_verified !== true || !identity.sub || typeof identity.email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(identity.email)) {
      throw new WorkspaceError('Google returned an unverified Calendar account.', 400);
    }
    const saved = await db.rpc('connect_google_calendar', {
      p_user: session.user.id, p_email: identity.email.toLowerCase(), p_subject: identity.sub,
      p_refresh: sealGmailSecret(tokens.refresh_token, session.user.id), p_access: sealGmailSecret(tokens.access_token, session.user.id),
      p_expires: new Date(tokens.expiry_date ?? Date.now() + 300000).toISOString(),
    });
    if (saved.error) throw databaseError(saved.error);
    const response = NextResponse.redirect(new URL('/account?tab=signature&google_calendar=connected', calendarCallbackUrl().origin));
    response.cookies.set('crm-calendar-oauth', '', { path: '/api/google-calendar', maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return workspaceApiError(error, 'google-calendar/callback'); }
}
