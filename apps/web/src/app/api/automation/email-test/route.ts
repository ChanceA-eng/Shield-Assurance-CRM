import { NextRequest, NextResponse } from 'next/server';
import { sendOutboundEmail } from '../../../../lib/email-adapter';
import { getApiSession } from '../../../../lib/api-auth';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { requireTeamPermission } from '../../../../lib/team-request-access';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    requireTeamPermission(session.teamAccess, 'automation.manage');
    const payload = await workspaceBody(request);
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
