import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createSupabaseServerAuthClient } from '../../../../lib/supabase-auth-server';
import { recoveryProof } from '../../../../lib/account-security';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await workspaceBody(request);
    if ((body.type !== 'recovery' && body.type !== 'email_change') || typeof body.token_hash !== 'string'
      || !/^[a-zA-Z0-9_-]{20,256}$/.test(body.token_hash)) throw new WorkspaceError('Invalid confirmation link.', 400);
    if (body.type === 'email_change') {
      const db = getSupabaseServerClient();
      if (!db) throw new WorkspaceError('Account security is unavailable.', 503);
      const confirmed = await db.rpc('confirm_account_email', { p_hash: createHash('sha256').update(body.token_hash).digest('hex') });
      if (confirmed.error) throw databaseError(confirmed.error);
      const found = await db.from('account_email_changes').select('user_id,new_email,old_confirmed_at,new_confirmed_at')
        .eq('id', confirmed.data).single<{ user_id: string; new_email: string; old_confirmed_at: string | null; new_confirmed_at: string | null }>();
      if (found.error) throw databaseError(found.error);
      const complete = Boolean(found.data.old_confirmed_at && found.data.new_confirmed_at);
      if (complete) {
        const saved = await db.auth.admin.updateUserById(found.data.user_id, { email: found.data.new_email, email_confirm: true });
        if (saved.error) {
          console.error('[account/confirm] Email update failed', saved.error.code);
          throw new WorkspaceError('Email change could not finish. Return to Security and send new links.', 409);
        }
      }
      return NextResponse.json({ message: complete ? 'Both addresses confirmed. Sign in with your new email.' : 'Address confirmed. Confirm the link sent to the other address to finish.' },
        { headers: { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
    }
    const auth = await createSupabaseServerAuthClient();
    const verified = await auth.auth.verifyOtp({ type: body.type, token_hash: body.token_hash });
    if (verified.error) {
      console.error('[account/confirm]', verified.error.code);
      throw new WorkspaceError('This link expired, was already used, or is no longer authorized. Request a new link.', 400);
    }
    const response = NextResponse.json({
      message: 'Recovery verified.',
      recovery: true,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Cache-Control', 'no-store');
    if (body.type === 'recovery') {
      if (!verified.data.user || !verified.data.session) throw new WorkspaceError('Recovery session could not be established.', 400);
      response.cookies.set('crm_recovery', recoveryProof(verified.data.user.id, verified.data.session.access_token), {
        httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 900,
      });
    }
    return response;
  } catch (error) { return workspaceApiError(error, 'account/confirm'); }
}
