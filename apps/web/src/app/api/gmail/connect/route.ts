import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { assertGmailEnabled, googleOAuthClient, GMAIL_SCOPES, GMAIL_SEND_ONLY_SCOPES, oauthStateHash, sealGmailSecret } from '../../../../lib/gmail-provider';
import { workspaceApiError, workspaceBody, databaseError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    assertGmailEnabled();
    await activeAgencyMember(db, session.user.id);
    const body = await workspaceBody(request);
    if (body.mode !== undefined && body.mode !== 'send_only' && body.mode !== 'shared_sync') {
      throw new WorkspaceError('Choose a supported Gmail connection mode.', 400);
    }
    const scopeMode = body.mode === 'send_only' ? 'send_only' : 'shared_sync';
    if (scopeMode === 'send_only' && body.accept_send_only !== true) {
      throw new WorkspaceError('Confirm Gmail will only send messages initiated by you; the CRM will not read or sync your mailbox.', 400);
    }
    if (scopeMode === 'shared_sync' && body.accept_shared_crm_sync !== true) {
      throw new WorkspaceError('Explicitly approve mailbox access and agency sharing of contact-matching threads.', 400);
    }
    const client = googleOAuthClient();
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const codes = await client.generateCodeVerifierAsync();
    const { error } = await db.from('gmail_oauth_states').insert({
      state_hash: oauthStateHash(state), user_id: session.user.id,
      verifier_secret: sealGmailSecret(codes.codeVerifier, session.user.id), browser_hash: oauthStateHash(browser),
      scope_mode: scopeMode,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    if (error) throw databaseError(error);
    const url = client.generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: scopeMode === 'send_only' ? GMAIL_SEND_ONLY_SCOPES : GMAIL_SCOPES, state,
      code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
    });
    const response = NextResponse.json({ url });
    response.cookies.set('crm-gmail-oauth', browser, {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/gmail', maxAge: 600,
    });
    return response;
  } catch (error) { return workspaceApiError(error, 'gmail/connect'); }
}
