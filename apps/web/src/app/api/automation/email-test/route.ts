import { NextRequest, NextResponse } from 'next/server';
import { sendOutboundEmail } from '../../../../lib/email-adapter';
import { getApiSession } from '../../../../lib/api-auth';
import { activeAgencyMember, agencyEnabled } from '../../../../lib/agency-membership';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const payload = await workspaceBody(request);
    if (agencyEnabled()) {
      const db = getSupabaseServerClient();
      if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
      if ((await activeAgencyMember(db, session.user.id)).role === 'agent') throw new WorkspaceError('Only administrators can test agency email setup.', 403);
    }
    const to = session.user.email?.toLowerCase();
    if (!to || (payload.to !== undefined && payload.to !== to)) throw new WorkspaceError('Setup tests can only be sent to your signed-in email address.', 400);
    const subject = 'Shield CRM test email';
    const body = 'This is a test email from Shield CRM automation.';
    await sendOutboundEmail({ to, subject, body, requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined });
    return NextResponse.json({ ok: true, to, subject, delivery: 'accepted_by_provider', provider: 'resend' }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'email/setup-test');
  }
}
