import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled } from '../../../lib/agency-membership';
import { WorkspaceError } from '../../../lib/record-scope';
import { workspaceApiError, workspaceBody, databaseError } from '../../../lib/workspace-api';
import { parseOutreachSender } from '../../../lib/marketing-profile';
import { isUuid } from '../../../lib/workspace-validation';
import { getOutreachSender } from '../../../lib/marketing-profile';
import { activateTeamMember } from '../../../lib/team-management';
import { isTeamActivationRequest } from '../../../lib/route-authentication';
import { readTeamContact, readTeamSettings, writeTeamSettings } from '../../../lib/team-settings';
import { hasTeamPermission, requireTeamPermission } from '../../../lib/team-request-access';

async function handle(request: NextRequest): Promise<NextResponse> {
  const activating = isTeamActivationRequest(request.nextUrl.pathname, request.method, request.nextUrl.searchParams);
  const session = await getApiSession(request, activating ? { teamActivation: true } : undefined);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    if (activating) return await activateTeamMember(request, db, session.user.id);
    if (request.nextUrl.searchParams.get('access') === 'true') throw new WorkspaceError('Use the new Team access workspace.', 410);
    if (request.nextUrl.searchParams.get('team') === 'true') {
      const headers = { 'Cache-Control': 'private, no-store' };
      if (request.method === 'GET') {
        const profile = request.nextUrl.searchParams.get('profile');
        return NextResponse.json(profile === null ? await readTeamSettings(db, session.user.id)
          : await readTeamContact(db, session.user.id, profile), { headers });
      }
      if (request.method !== 'POST') throw new WorkspaceError('Choose a Team action.', 405);
      await writeTeamSettings(request, db, session.user.id);
      return NextResponse.json({ ok: true }, { headers });
    }
    if (request.method === 'POST' && request.nextUrl.searchParams.get('bootstrap') === 'true') {
      if (!process.env.CRM_BOOTSTRAP_OWNER_ID || session.user.id !== process.env.CRM_BOOTSTRAP_OWNER_ID) throw new WorkspaceError('Owner bootstrap is not authorized.', 403);
      const { error } = await db.rpc('bootstrap_agency_owner', { p_user: session.user.id });
      if (error) throw databaseError(error);
      return NextResponse.json({ ok: true });
    }
    const member = await activeAgencyMember(db, session.user.id);
    if ((request.method === 'GET' || request.method === 'PUT') && !agencyEnabled()) {
      throw new WorkspaceError('Personal sender profiles are not enabled.', 503);
    }
    if (request.method === 'GET') {
      const members = hasTeamPermission(session.teamAccess, 'team.manage')
        ? await db.from('agency_members').select('user_id,email,role,active').order('email')
        : { data: [], error: null };
      if (members.error) throw databaseError(members.error);
      const agencySender = await getOutreachSender(db);
      return NextResponse.json({
        member: { ...member, sender_profile: { ...(member.sender_profile ?? agencySender), agency: agencySender.agency, approved_claims: agencySender.approved_claims } },
        members: members.data, gmail_ai_enabled: process.env.CRM_GMAIL_AI_ENABLED === 'true',
      });
    }
    const body = await workspaceBody(request);
    if (request.method === 'PUT') {
      const agencySender = await getOutreachSender(db);
      const sender = parseOutreachSender(body.sender_profile);
      if (sender.agency !== agencySender.agency || sender.approved_claims !== agencySender.approved_claims) {
        throw new WorkspaceError('Agency identity and approved claims are managed by the owner in Settings. Reload your profile before saving.', 403);
      }
      const update = {
        sender_profile: sender,
        gmail_ai_opt_in: body.gmail_ai_opt_in === true,
        updated_at: new Date().toISOString(),
      };
      if (update.gmail_ai_opt_in && process.env.CRM_GMAIL_AI_ENABLED !== 'true') throw new WorkspaceError('Gmail-content AI is disabled pending privacy/provider approval.', 403);
      const { error } = await db.from('agency_members').update(update).eq('user_id', member.user_id).eq('active', true);
      if (error) throw databaseError(error);
      return NextResponse.json({ ok: true });
    }
    if (request.method === 'PATCH' && body.action === 'assign') {
      if (!agencyEnabled()) throw new WorkspaceError('Per-agent record assignment is not enabled.', 503);
      const type = body.record_type;
      if ((type !== 'client' && type !== 'lead') || !isUuid(body.record_id) || (body.user_id !== null && !isUuid(body.user_id))) throw new WorkspaceError('Choose valid record and agent IDs.', 400);
      requireTeamPermission(session.teamAccess, type === 'client' ? 'accounts.assign' : 'leads.assign');
      if (body.user_id) await activeAgencyMember(db, body.user_id);
      const saved = await db.rpc('assign_agency_agent', { p_actor: member.user_id, p_type: type, p_record: body.record_id, p_user: body.user_id });
      if (saved.error) throw databaseError(saved.error);
    } else {
      requireTeamPermission(session.teamAccess, 'team.manage');
      throw new WorkspaceError('Use Team access to invite or edit a member.', 410);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'agency'); }
}
export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function PUT(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return handle(request); }
