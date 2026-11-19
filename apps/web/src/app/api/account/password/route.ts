import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { createSupabaseServerAuthClient } from '../../../../lib/supabase-auth-server';
import { reauthenticate, validatePassword, validRecoveryProof } from '../../../../lib/account-security';
import { WorkspaceError } from '../../../../lib/record-scope';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Account security is unavailable.', 503);
    const body = await workspaceBody(request);
    validatePassword(body.password);
    if (body.password !== body.confirm_password) throw new WorkspaceError('The new passwords do not match.', 400);
    const auth = await createSupabaseServerAuthClient();
    const current = await auth.auth.getSession();
    if (current.error || !current.data.session) throw new WorkspaceError('Sign in again before changing your password.', 401);
    const recovery = validRecoveryProof(request.cookies.get('crm_recovery')?.value, session.user.id, current.data.session.access_token);
    if (!recovery) await reauthenticate(db, session.user, body.current_password);
    const result = await auth.auth.updateUser({ password: body.password });
    if (result.error) {
      console.error('[account/password]', result.error.code);
      throw new WorkspaceError('Password could not be changed. Verify your password requirements and retry.', 400);
    }
    const signedOut = await auth.auth.signOut({ scope: 'others' });
    if (signedOut.error) {
      console.error('[account/password] Other-session revocation failed', signedOut.error.code);
      throw new WorkspaceError('Your password changed, but other sessions could not be revoked. Sign out of other devices and contact support.', 503);
    }
    const response = NextResponse.json({ message: 'Password changed. Other refresh sessions have been revoked; existing access tokens expire normally.' });
    response.cookies.delete('crm_recovery');
    return response;
  } catch (error) { return workspaceApiError(error, 'account/password'); }
}
