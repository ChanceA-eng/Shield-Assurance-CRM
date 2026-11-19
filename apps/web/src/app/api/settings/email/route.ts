import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { emailConfigurationHash, emailConnectionStatus } from '../../../../lib/email-setup';
import { sendOutboundEmail } from '../../../../lib/email-adapter';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { resendConfiguration, resendConfigured } from '@crm/shared/resend';

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Database unavailable. Contact support.' }, { status: 503 });
  try {
    const owner = await requireAgencyOwner(db, session.user.id);
    if (request.method === 'GET') return NextResponse.json(await emailConnectionStatus(db, session.user.id), { headers: { 'Cache-Control': 'private, no-store' } });
    const body = await workspaceBody(request);
    if (!isUuid(body.request_id) || Object.keys(body).some((key) => key !== 'request_id')) {
      throw new WorkspaceError('Start a test from Settings. The recipient and message cannot be customized.', 400);
    }
    if (owner.email.toLowerCase() !== session.user.email?.toLowerCase()) {
      throw new WorkspaceError('The owner login email changed. Update the agency membership before testing.', 409);
    }
    if (!resendConfigured(resendConfiguration(process.env))) throw new WorkspaceError('Requires deployment configuration: enable sending and complete the Resend credentials before testing.', 503);
    const id = body.request_id.toLowerCase();
    const claimed = await db.rpc('claim_email_setup_check', {
      p_actor: owner.user_id, p_id: id, p_configuration_hash: emailConfigurationHash(),
    });
    if (claimed.error) throw databaseError(claimed.error);
    await sendOutboundEmail({
      to: owner.email.toLowerCase(), subject: `[CRM reply check ${id}]`,
      body: 'Shield CRM email test.\n\nReply to this email with "Reply check". Then return to Settings > Email and refresh the status.\n\nThis setup check verifies reply routing. It does not create a client conversation.',
      requestId: `email-setup:${id}`,
    });
    return NextResponse.json({ message: `Test accepted by Resend for ${owner.email}. Reply to it, then refresh status.` });
  } catch (error) { return workspaceApiError(error, 'settings/email'); }
}

export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request); }
