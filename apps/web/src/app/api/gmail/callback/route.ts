import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { assertGmailEnabled, googleOAuthClient, GMAIL_SCOPES, GMAIL_SEND_ONLY_SCOPES, oauthStateHash, openGmailSecret, sealGmailSecret } from '../../../../lib/gmail-provider';
import { workspaceApiError, databaseError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    assertGmailEnabled();
    await activeAgencyMember(db, session.user.id);
    const state = request.nextUrl.searchParams.get('state') ?? '';
    const browser = request.cookies.get('crm-gmail-oauth')?.value ?? '';
    const code = request.nextUrl.searchParams.get('code');
    if (!state || !browser || !code || request.nextUrl.searchParams.has('error')) throw new WorkspaceError('Gmail authorization was denied or incomplete. Start again in My Account.', 400);
    const claimed = await db.from('gmail_oauth_states').delete()
      .eq('state_hash', oauthStateHash(state)).eq('browser_hash', oauthStateHash(browser)).eq('user_id', session.user.id)
      .gt('expires_at', new Date().toISOString()).select('verifier_secret,scope_mode').maybeSingle();
    if (claimed.error) throw databaseError(claimed.error);
    if (!claimed.data) throw new WorkspaceError('Gmail authorization expired or was already used. Start again.', 400);
    const client = googleOAuthClient();
    let tokens;
    try { tokens = (await client.getToken({ code, codeVerifier: openGmailSecret(claimed.data.verifier_secret, session.user.id) })).tokens; }
    catch { throw new WorkspaceError('Google authorization could not be completed. Start again.', 400); }
    const sendOnly = claimed.data.scope_mode === 'send_only';
    const requiredScopes = sendOnly ? GMAIL_SEND_ONLY_SCOPES : GMAIL_SCOPES;
    if (!tokens.access_token || !tokens.refresh_token || !requiredScopes.every((scope) => tokens.scope?.split(' ').includes(scope))) {
      throw new WorkspaceError(sendOnly
        ? 'Gmail send permission and offline access are required. Reconnect and approve the requested permissions.'
        : 'Both Gmail read and send permissions, including offline access, are required. Reconnect and approve both permissions.', 400);
    }
    let email: string | null = null;
    if (sendOnly) {
      if (!tokens.id_token) throw new WorkspaceError('Google did not return a verified account identity. Start the connection again.', 503);
      let identity;
      try { identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID })).getPayload(); }
      catch { throw new WorkspaceError('Google mailbox identity could not be verified.', 503); }
      if (identity?.email_verified === true && typeof identity.email === 'string') email = identity.email.toLowerCase();
    }
    if (!sendOnly) {
      const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000),
      });
      if (!profileResponse.ok) throw new WorkspaceError('Google mailbox identity could not be verified.', 503);
      const profile = await profileResponse.json() as { emailAddress?: string };
      if (!profile.emailAddress || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(profile.emailAddress)) throw new WorkspaceError('Google returned an invalid mailbox identity.', 503);
      email = profile.emailAddress.toLowerCase();
    }
    if (!email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new WorkspaceError('Google returned an invalid mailbox identity.', 503);
    const connected = await db.rpc(sendOnly ? 'connect_personal_gmail' : 'connect_agent_gmail', {
      p_user: session.user.id, p_email: email,
      p_refresh: sealGmailSecret(tokens.refresh_token, session.user.id),
      p_access: sealGmailSecret(tokens.access_token, session.user.id),
      p_expires: new Date(tokens.expiry_date ?? Date.now() + 300000).toISOString(),
    });
    if (connected.error) throw databaseError(connected.error);
    const response = NextResponse.redirect(new URL('/account?tab=signature&gmail=connected', request.url));
    response.cookies.delete('crm-gmail-oauth');
    return response;
  } catch (error) { return workspaceApiError(error, 'gmail/callback'); }
}
