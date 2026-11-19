import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { sealGmailSecret } from '../../../../lib/gmail-provider';
import { CALENDAR_SCOPES, calendarOAuthClient, calendarStateHash } from '../../../../lib/google-calendar';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await activeAgencyMember(db, session.user.id);
    const client = calendarOAuthClient(), codes = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    const saved = await db.from('google_calendar_oauth_states').insert({
      state_hash: calendarStateHash(state), browser_hash: calendarStateHash(browser), user_id: session.user.id,
      verifier_secret: sealGmailSecret(codes.codeVerifier, session.user.id), expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    if (saved.error) throw databaseError(saved.error);
    const url = client.generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: CALENDAR_SCOPES, state,
      include_granted_scopes: false, code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
    });
    const response = NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('crm-calendar-oauth', browser, {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/google-calendar', maxAge: 600,
    });
    return response;
  } catch (error) { return workspaceApiError(error, 'google-calendar/connect'); }
}
