import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { sealGmailSecret } from '../../../../lib/gmail-provider';
import { calendarStateHash } from '../../../../lib/google-calendar';
import { zoomCallbackUrl, zoomTokens, zoomTokenRequest } from '../../../../lib/zoom-provider';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await activeAgencyMember(db, session.user.id);
    const state = request.nextUrl.searchParams.get('state'), code = request.nextUrl.searchParams.get('code');
    const browser = request.cookies.get('crm-zoom-oauth')?.value;
    if (!state || !code || !browser || request.nextUrl.searchParams.has('error')) throw new WorkspaceError('Zoom authorization was denied or incomplete. Connect again.', 400);
    const claimed = await db.from('zoom_oauth_states').delete()
      .eq('state_hash', calendarStateHash(state)).eq('browser_hash', calendarStateHash(browser)).eq('user_id', session.user.id)
      .gt('expires_at', new Date().toISOString()).select('state_hash').maybeSingle();
    if (claimed.error) throw databaseError(claimed.error);
    if (!claimed.data) throw new WorkspaceError('Zoom authorization expired or was already used. Connect again.', 400);
    const tokens = await zoomTokens(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: zoomCallbackUrl().href }));
    const identity = await zoomTokenRequest(tokens.access_token, '/users/me');
    if (!isRecord(identity) || typeof identity.id !== 'string' || !identity.id || typeof identity.email !== 'string'
      || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(identity.email) || identity.status !== 'active') {
      throw new WorkspaceError('Zoom did not return an active account identity. Connect an active Zoom account.', 400);
    }
    const result = await db.rpc('connect_zoom', {
      p_user: session.user.id, p_email: identity.email.toLowerCase(), p_subject: identity.id,
      p_refresh: sealGmailSecret(tokens.refresh_token, session.user.id), p_access: sealGmailSecret(tokens.access_token, session.user.id),
      p_expires: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });
    if (result.error) throw databaseError(result.error);
    const response = NextResponse.redirect(new URL('/account?tab=signature&zoom=connected', zoomCallbackUrl().origin));
    response.cookies.set('crm-zoom-oauth', '', { path: '/api/zoom', maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return workspaceApiError(error, 'zoom/callback'); }
}
