import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getMarketingProfile, parseMarketingProfile, saveMarketingProfile } from '../../../../lib/marketing-profile';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { hasTeamPermission, requireTeamPermission } from '../../../../lib/team-request-access';
import { isUuid } from '../../../../lib/workspace-validation';

async function handle(request: NextRequest, write: boolean): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const type = request.nextUrl.searchParams.get('record_type');
    const id = request.nextUrl.searchParams.get('record_id') ?? '';
    if (type !== 'lead' && type !== 'client') throw new WorkspaceError('Choose a lead or client.', 400);
    if (!isUuid(id)) throw new WorkspaceError('A valid record id is required.', 400);
    const profileInput = write ? parseMarketingProfile((await workspaceBody(request)).profile) : null;
    const permission = type === 'lead' ? (write ? 'leads.edit' : 'leads.view')
      : (write ? 'accounts.edit' : 'accounts.view');
    requireTeamPermission(session.teamAccess, permission, 'assigned');
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new WorkspaceError('The CRM database is not connected. Contact your administrator.', 503);
    if (!hasTeamPermission(session.teamAccess, permission)) {
      const table = type === 'lead' ? 'leads' : 'clients';
      const { data, error } = await supabase.from(table).select('agent_user_id').eq('id', id)
        .maybeSingle<{ agent_user_id: string | null }>();
      if (error) throw databaseError(error);
      if (!data || data.agent_user_id !== session.user.id) throw new WorkspaceError('Record not found.', 404);
    }
    const profile = write
      ? await saveMarketingProfile(supabase, { type, id }, profileInput)
      : await getMarketingProfile(supabase, { type, id });
    return NextResponse.json({ profile });
  } catch (error) {
    return workspaceApiError(error, 'outreach/profile');
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request, false); }
export async function PUT(request: NextRequest): Promise<NextResponse> { return handle(request, true); }
