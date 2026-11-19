import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../../lib/agency-access';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { workspaceBody, workspaceApiError, databaseError } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';

async function handle(request: NextRequest, mutation: boolean): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const body = mutation ? await workspaceBody(request) : null;
    if (body && (typeof body.enabled !== 'boolean' || Object.keys(body).some((key) => key !== 'enabled'))) {
      throw new WorkspaceError('Choose whether background scheduling is enabled.', 400);
    }
    const result = body ? await db.rpc('configure_crm_scheduler', { p_actor: session.user.id, p_enabled: body.enabled }) : await db.rpc('crm_scheduler_status');
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'settings/automation/scheduler'); }
}
export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request, false); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return handle(request, true); }
