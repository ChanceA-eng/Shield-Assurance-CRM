import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled, teamInviteRedirect } from '../../../lib/agency-membership';
import { WorkspaceError } from '../../../lib/record-scope';
import { workspaceApiError, workspaceBody, databaseError } from '../../../lib/workspace-api';
import { parseOutreachSender } from '../../../lib/marketing-profile';
import { isUuid } from '../../../lib/workspace-validation';
import { requireAgencyOwner } from '../../../lib/agency-access';
import { getOutreachSender } from '../../../lib/marketing-profile';
import { activateTeamMember, manageTeam, teamManagementReady } from '../../../lib/team-management';
import { isTeamActivationRequest } from '../../../lib/route-authentication';

async function handle(request: NextRequest): Promise<NextResponse> {
  const activating = isTeamActivationRequest(request.nextUrl.pathname, request.method, request.nextUrl.searchParams);
  const session = await getApiSession(request, activating ? { teamActivation: true } : undefined);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    if (activating) return await activateTeamMember(request, db, session.user.id);
    if (request.nextUrl.searchParams.get('access') === 'true') {
      if (request.method !== 'GET' && request.method !== 'POST') throw new WorkspaceError('Choose a team action.', 405);
      return await manageTeam(request, db, session.user.id);
    }
    if (request.method === 'GET' && request.nextUrl.searchParams.get('team') === 'true') {
      const member = await requireAgencyOwner(db, session.user.id);
      if (await teamManagementReady(db)) {
        const management = await manageTeam(request, db, session.user.id);
        const data = await management.json();
        return NextResponse.json({ management: data }, { headers: { 'Cache-Control': 'private, no-store' } });
      }
      const members = await db.from('agency_members').select('user_id,email,role,active').order('email');
      if (members.error) throw databaseError(members.error);
      const issues = teamInviteRedirect() ? [] : ['Configure the CRM activation URL and allow it in the sign-in settings.'];
      return NextResponse.json({ member: { user_id: member.user_id, email: member.email, role: member.role, active: member.active },
        members: members.data, enabled: true, can_invite: issues.length === 0, issues },
      { headers: { 'Cache-Control': 'private, no-store' } });
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
      const members = member.role === 'owner'
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
    if (member.role === 'agent') throw new WorkspaceError('Administrator access is required.', 403);
    if (request.method === 'POST') {
      await requireAgencyOwner(db, session.user.id);
      if (await teamManagementReady(db)) throw new WorkspaceError('Open Team and choose a role before inviting.', 409);
      if (body.confirm_crm_access !== true) throw new WorkspaceError('Confirm that this member should have access to agency customer records.', 400);
      const redirectTo = teamInviteRedirect();
      if (!redirectTo) throw new WorkspaceError('The CRM activation URL is not configured. Contact your administrator.', 503);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new WorkspaceError('Enter a valid invitation email.', 400);
      const previous = await db.from('agency_members').select('user_id').eq('email', email).maybeSingle();
      if (previous.error) throw databaseError(previous.error);
      if (previous.data) throw new WorkspaceError('This person is already a team member. Manage their access or have them reset their password.', 409);
      // Invitations never create administrators. Role promotion is a separate audited owner action.
      const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (invited.error || !invited.data.user) {
        console.error('[agency/invite] Auth invitation failed', { code: invited.error?.code, status: invited.error?.status });
        if (invited.error?.code === 'email_exists' || invited.error?.code === 'user_already_exists') {
          throw new WorkspaceError('This email already has a sign-in account. Ask your administrator to review its team access.', 409);
        }
        throw new WorkspaceError('The invitation email could not be sent. Try again; if it still fails, contact your administrator.', 503);
      }
      const saved = await db.from('agency_members').insert({ user_id: invited.data.user.id, email, role: 'agent' });
      if (saved.error) throw new WorkspaceError('The invitation email was issued, but agency membership could not be recorded. An owner must recover this existing auth user with the documented database procedure; do not create a second account.', 503);
      const audit = await db.from('agency_audit').insert({ actor_id: member.user_id, target_id: invited.data.user.id, action: 'agent_invited' });
      if (audit.error) throw databaseError(audit.error);
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (body.action === 'assign') {
      if (!agencyEnabled()) throw new WorkspaceError('Per-agent record assignment is not enabled.', 503);
      const type = body.record_type;
      if ((type !== 'client' && type !== 'lead') || !isUuid(body.record_id) || (body.user_id !== null && !isUuid(body.user_id))) throw new WorkspaceError('Choose valid record and agent IDs.', 400);
      if (body.user_id) await activeAgencyMember(db, body.user_id);
      const saved = await db.rpc('assign_agency_agent', { p_actor: member.user_id, p_type: type, p_record: body.record_id, p_user: body.user_id });
      if (saved.error) throw databaseError(saved.error);
    } else {
      await requireAgencyOwner(db, session.user.id);
      if (!isUuid(body.user_id) || typeof body.active !== 'boolean' || !['admin', 'agent'].includes(String(body.role))) throw new WorkspaceError('Choose a valid member, role and active state.', 400);
      const target = await db.from('agency_members').select('role').eq('user_id', body.user_id).maybeSingle();
      if (target.error) throw databaseError(target.error);
      if (target.data?.role === 'owner') throw new WorkspaceError('Owner access cannot be changed through Team.', 403);
      if (await teamManagementReady(db)) throw new WorkspaceError('Open Team to update this member’s role and access.', 409);
      const { error } = await db.rpc('manage_agency_member', { p_actor: member.user_id, p_target: body.user_id, p_role: body.role, p_active: body.active });
      if (error) throw databaseError(error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'agency'); }
}
export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function PUT(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return handle(request); }
