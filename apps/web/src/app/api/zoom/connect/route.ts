import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { calendarStateHash } from '../../../../lib/google-calendar';
import { zoomCallbackUrl, zoomConfigured } from '../../../../lib/zoom-provider';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await activeAgencyMember(db, session.user.id);
    if (!zoomConfigured()) throw new WorkspaceError('Zoom connection is not enabled yet. Contact your administrator.', 503);
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    const result = await db.from('zoom_oauth_states').insert({
      state_hash: calendarStateHash(state), browser_hash: calendarStateHash(browser), user_id: session.user.id,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    if (result.error) throw databaseError(result.error);
    const url = new URL('https://zoom.us/oauth/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: process.env.ZOOM_CLIENT_ID!, redirect_uri: zoomCallbackUrl().href, state }).toString();
    const response = NextResponse.json({ url: url.href }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('crm-zoom-oauth', browser, {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/zoom', maxAge: 600,
    });
    return response;
  } catch (error) { return workspaceApiError(error, 'zoom/connect'); }
}
