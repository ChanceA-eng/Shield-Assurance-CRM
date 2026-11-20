import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';
import { readPendingEmailChanges } from '../../../../lib/account-security';
import { requireTeamPermission } from '../../../../lib/team-request-access';

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Account security is unavailable.', 503);
    requireTeamPermission(session.teamAccess, 'team.manage');
    if (request.method === 'GET') {
      return NextResponse.json({ requests: await readPendingEmailChanges(db) }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || typeof body.approve !== 'boolean') throw new WorkspaceError('Choose a current email change request.', 400);
    const result = await db.rpc('decide_account_email', { p_actor: session.user.id, p_request: body.id, p_approve: body.approve });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json({ message: body.approve ? 'Approved. The agent must verify both email addresses.' : 'Request rejected. The sign-in email is unchanged.' });
  } catch (error) { return workspaceApiError(error, 'settings/account-email'); }
}
export const GET = handle;
export const POST = handle;
