import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { accountMembership } from '../../../../lib/agency-access';
import { accountOrigin, reauthenticate, securityLimit, type EmailChange } from '../../../../lib/account-security';
import { sendAccountMail } from '../../../../lib/account-mail';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Account security is unavailable.', 503);
    const member = await accountMembership(db, session.user.id);
    if (!member?.active) throw new WorkspaceError('An active agency membership is required.', 403);
    const body = await workspaceBody(request);
    await reauthenticate(db, session.user, body.current_password);
    if (body.action === 'verify') {
      await securityLimit(db, 'email-verification', session.user.id, 3);
      const found = await db.from('account_email_changes').select('*').eq('user_id', session.user.id)
        .eq('status', 'approved').gt('expires_at', new Date().toISOString()).maybeSingle<EmailChange>();
      if (found.error) throw databaseError(found.error);
      if (!found.data || found.data.old_email !== session.user.email) throw new WorkspaceError('No current approved email change. Submit a new request.', 409);
      const origin = accountOrigin();
      const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
      const saved = await db.from('account_email_changes').update({
        old_token_hash: createHash('sha256').update(tokens[0]).digest('hex'),
        new_token_hash: createHash('sha256').update(tokens[1]).digest('hex'),
        old_confirmed_at: null, new_confirmed_at: null,
      }).eq('id', found.data.id).eq('status', 'approved').select('id').maybeSingle();
      if (saved.error) throw databaseError(saved.error);
      if (!saved.data) throw new WorkspaceError('This request has changed. Reload Security.', 409);
      for (const [index, to] of [found.data.old_email, found.data.new_email].entries()) {
        const link = `${origin}/auth/confirm#type=email_change&token_hash=${tokens[index]}`;
        await sendAccountMail(to, 'Confirm your Shield CRM sign-in email change',
          `Confirm your requested sign-in email change to ${found.data.new_email}.\n\n${link}\n\nConfirm both email addresses. If you did not request this change, do not confirm it and contact the agency owner.`,
          tokens[index]);
      }
      return NextResponse.json({ message: 'Verification links sent to your current and new addresses. Confirm both to finish.' });
    }
    if (body.action === 'cancel') {
      const result = await db.from('account_email_changes').update({ status: 'cancelled' })
        .eq('user_id', session.user.id).in('status', ['pending', 'approved']);
      if (result.error) throw databaseError(result.error);
      return NextResponse.json({ message: 'Email change cancelled. Your sign-in email has not changed.' });
    }
    if (body.action !== 'request' || typeof body.email !== 'string' || body.email.length > 254) throw new WorkspaceError('Enter your new email address.', 400);
    await securityLimit(db, 'email-request', session.user.id);
    const result = await db.rpc('request_account_email', { p_actor: session.user.id, p_email: body.email });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json({ message: member.role === 'agent'
      ? 'Request sent to the owner. After approval, return here to verify both addresses.'
      : 'Request saved. Send verification links to confirm both addresses.' });
  } catch (error) { return workspaceApiError(error, 'account/email'); }
}
