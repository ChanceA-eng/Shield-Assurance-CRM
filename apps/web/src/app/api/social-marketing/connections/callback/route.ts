import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sealSocialToken } from '@crm/shared/social-token-crypto';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { socialDatabaseError } from '../../../../../lib/social-marketing-errors';
import { workspaceApiError } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import {
  exchangeSocialMetaCode, socialMetaCookieNames, socialMetaConfigurationIssues,
} from '../../../../../lib/social-meta-provider';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  const names = socialMetaCookieNames();
  const state = request.nextUrl.searchParams.get('state') ?? '';
  const browser = request.cookies.get(names.state)?.value ?? '';
  let response: NextResponse;
  try {
    const issues = socialMetaConfigurationIssues();
    if (issues.length) throw new WorkspaceError(issues.join(' '), 503);
    if (!state || !browser) throw new WorkspaceError('Meta authorization state is missing. Start again in Social Marketing.', 400);
    const claimed = await db.rpc('consume_social_oauth_state', {
      p_actor: session.user.id, p_state_hash: hash(state), p_browser_hash: hash(browser),
    });
    if (claimed.error) throw socialDatabaseError(claimed.error);
    if (!claimed.data || typeof claimed.data !== 'object') throw new WorkspaceError('Meta authorization could not be confirmed. Start again.', 503);
    const details = claimed.data as { workspace_id?: string; redirect_uri?: string };
    if (!details.workspace_id || !details.redirect_uri) throw new WorkspaceError('Meta authorization state was invalid. Start again.', 400);
    const callbackOrigin = new URL(details.redirect_uri);
    if (request.nextUrl.searchParams.has('error') || !request.nextUrl.searchParams.get('code')) {
      response = NextResponse.redirect(new URL('/communication/social?connection=denied', callbackOrigin));
    } else {
      const grant = await exchangeSocialMetaCode(request.nextUrl.searchParams.get('code') ?? '', details.redirect_uri);
      const grantId = randomUUID();
      const saved = await db.rpc('store_social_oauth_grant', {
        p_actor: session.user.id, p_id: grantId, p_external_user_id: grant.userId, p_user_name: grant.userName,
        p_encrypted_user_token: sealSocialToken(grant.accessToken, `${details.workspace_id}:meta:user:${grant.userId}`),
        p_granted_scopes: grant.scopes, p_token_expires_at: grant.expiresAt,
      });
      if (saved.error) throw socialDatabaseError(saved.error);
      if (!saved.data) throw new WorkspaceError('Meta connected, but account discovery could not be started. Retry authorization.', 503);
      response = NextResponse.redirect(new URL('/communication/social?connection=ready', callbackOrigin));
      response.cookies.set(names.grant, grantId, {
        httpOnly: true, secure: callbackOrigin.protocol === 'https:', sameSite: 'lax',
        path: '/api/social-marketing/connections', maxAge: 600,
      });
    }
  } catch (error) { response = workspaceApiError(error, 'social-connections/callback'); }
  response.cookies.set(names.state, '', {
    httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
    path: '/api/social-marketing/connections/callback', maxAge: 0,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
