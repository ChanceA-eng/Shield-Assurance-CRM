import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { accountOrigin, securityLimit } from '../../../../lib/account-security';
import { sendAccountMail } from '../../../../lib/account-mail';
import { WorkspaceError } from '../../../../lib/record-scope';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await workspaceBody(request);
    if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.email.trim())) {
      throw new WorkspaceError('Enter a valid sign-in email address.', 400);
    }
    const email = body.email.trim().toLowerCase();
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Account recovery is unavailable.', 503);
    await securityLimit(db, 'recovery-email', email, 3);
    await securityLimit(db, 'recovery-total', 'agency', 30);
    const origin = accountOrigin();
    const generated = await db.auth.admin.generateLink({ type: 'recovery', email });
    if (generated.error) {
      if (generated.error.code !== 'user_not_found' && generated.error.status !== 404) {
        console.error('[account/recovery] Link generation failed', generated.error.code);
        throw new WorkspaceError('Recovery is temporarily unavailable. Please try again later.', 503);
      }
    } else if (generated.data.properties) {
      const link = `${origin}/auth/confirm#type=recovery&token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}`;
      await sendAccountMail(email, 'Reset your Shield CRM password',
        `Use this link to reset your Shield CRM password:\n\n${link}\n\nIf you did not request this, ignore this email.`,
        generated.data.properties.hashed_token);
    } else throw new WorkspaceError('Recovery is temporarily unavailable. Please try again later.', 503);
    return NextResponse.json({ message: 'If that account exists, a password reset link has been sent. Check your inbox.' });
  } catch (error) { return workspaceApiError(error, 'account/recovery'); }
}
