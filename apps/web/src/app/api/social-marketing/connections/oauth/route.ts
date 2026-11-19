import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { socialDatabaseError } from '../../../../../lib/social-marketing-errors';
import { workspaceApiError } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { socialMetaAuthorizationUrl, socialMetaCookieNames, socialMetaConfigurationIssues } from '../../../../../lib/social-meta-provider';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const issues = socialMetaConfigurationIssues();
    if (issues.length) throw new WorkspaceError(issues.join(' '), 503);
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const redirectUri = process.env.SOCIAL_META_REDIRECT_URI;
    if (!redirectUri) throw new WorkspaceError('Configure SOCIAL_META_REDIRECT_URI.', 503);
    const started = await db.rpc('begin_social_oauth', {
      p_actor: session.user.id, p_state_hash: hash(state), p_browser_hash: hash(browser), p_redirect_uri: redirectUri,
    });
    if (started.error) throw socialDatabaseError(started.error);
    const response = NextResponse.json({ url: socialMetaAuthorizationUrl(state) }, { headers: { 'Cache-Control': 'private, no-store' } });
    response.cookies.set(socialMetaCookieNames().state, browser, {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
      path: '/api/social-marketing/connections/callback', maxAge: 600,
    });
    return response;
  } catch (error) { return workspaceApiError(error, 'social-connections/oauth'); }
}
