import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTeamExceptions, parseTeamGrants, resolveTeamAccess, TeamAccessError, validateTeamAccess, type TeamAccess } from '@crm/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAgencyOwner } from './agency-access';
import { teamInviteRedirect } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { databaseError, workspaceBody } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';

export interface ManagedTeamMember {
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'agent';
  active: boolean;
  team_role_id: string | null;
  access_version: number;
  access_exceptions: Record<string, unknown>;
  invitation_id: string | null;
}

export interface ManagedTeamRole {
  id: string;
  name: string;
  version: number;
  grants: TeamAccess;
}

interface TeamInvitation {
  id: string;
  email: string;
  role_id: string;
  state: 'pending' | 'delivery_failed' | 'sent';
  version: number;
  delivery_error: string | null;
}

export interface TeamManagementData {
  ready: boolean;
  members: ManagedTeamMember[];
  roles: ManagedTeamRole[];
  invitations: TeamInvitation[];
}

export async function teamManagementReady(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.from('team_access_rollout').select('enabled,enforcement_version').eq('singleton', true).single();
  if (error?.code === 'PGRST205' || error?.code === '42P01') return false;
  if (error) throw databaseError(error);
  return data.enabled === true && data.enforcement_version >= 1;
}

export async function activateTeamMember(request: NextRequest, db: SupabaseClient, actor: string): Promise<NextResponse> {
  const member = await db.from('agency_members').select('active,invitation_id').eq('user_id', actor).maybeSingle();
  if (member.error?.code === '42703' || member.error?.code === 'PGRST204') {
    const legacy = await db.from('agency_members').select('active').eq('user_id', actor).maybeSingle();
    if (legacy.error) throw databaseError(legacy.error);
    if (request.method === 'GET' && legacy.data?.active) return response({ needsActivation: false });
  } else if (member.error) throw databaseError(member.error);
  if (request.method === 'GET' && member.data?.active) return response({ needsActivation: false });
  if (!member.data?.invitation_id || !(await teamManagementReady(db))) throw new WorkspaceError('An active invitation is required.', 403);
  const invitation = await db.from('team_invitations').select('state').eq('id', member.data.invitation_id).eq('user_id', actor).maybeSingle();
  if (invitation.error) throw databaseError(invitation.error);
  if (invitation.data?.state !== 'sent' && !(invitation.data?.state === 'accepted' && member.data.active)) {
    throw new WorkspaceError('This invitation is not available. Ask the owner for access.', 403);
  }
  if (request.method === 'GET') return response({ needsActivation: true });
  const result = await db.rpc('accept_team_invitation', { p_user: actor, p_id: member.data.invitation_id });
  if (result.error) throw databaseError(result.error);
  const data: unknown = result.data;
  if (!isRecord(data) || data.user_id !== actor) throw new WorkspaceError('Team activation could not be verified.', 503);
  return response({ ok: true });
}

const roleId = (input: unknown): input is string => typeof input === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(input) && input !== 'owner';
const version = (input: unknown): input is number => typeof input === 'number' && Number.isInteger(input) && input > 0 && input < 2147483647;
const response = (data: unknown, status = 200): NextResponse => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function manageTeam(request: NextRequest, db: SupabaseClient, actor: string): Promise<NextResponse> {
  await requireAgencyOwner(db, actor);
  if (!(await teamManagementReady(db))) {
    if (request.method === 'GET') return response({ ready: false });
    throw new WorkspaceError('Role-based invitations are not available yet.', 503);
  }
  if (request.method === 'GET') {
    const [members, roles, invitations] = await Promise.all([
      db.from('agency_members').select('user_id,email,role,active,team_role_id,access_version,access_exceptions,invitation_id').order('email'),
      db.from('team_role_bundles').select('id,name,version,grants').order('name'),
      db.from('team_invitations').select('id,email,role_id,state,version,delivery_error').in('state', ['pending', 'delivery_failed', 'sent']).order('email'),
    ]);
    const error = members.error ?? roles.error ?? invitations.error;
    if (error) throw databaseError(error);
    return response({ ready: true, members: members.data, roles: roles.data, invitations: invitations.data });
  }

  const body = await workspaceBody(request);
  try {
    switch (body.action) {
      case 'save_role': {
        if (!roleId(body.role_id) || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80
          || (body.version !== null && !version(body.version))) throw new WorkspaceError('Enter a role name and choose its permissions.', 400);
        const grants = resolveTeamAccess(parseTeamGrants(body.grants));
        const { error } = await db.rpc('save_team_role', {
          p_actor: actor, p_id: body.role_id, p_name: body.name.trim(), p_grants: grants, p_expected_version: body.version,
        });
        if (error) throw databaseError(error);
        return response({ ok: true });
      }
      case 'edit_access': {
        if (!isUuid(body.user_id) || !roleId(body.role_id) || typeof body.active !== 'boolean' || !version(body.version)) {
          throw new WorkspaceError('Choose a member, role and access status.', 400);
        }
        parseTeamExceptions(body.exceptions);
        const { error } = await db.rpc('set_team_member_access', {
          p_actor: actor, p_target: body.user_id, p_role_id: body.role_id, p_exceptions: body.exceptions,
          p_active: body.active, p_expected_version: body.version,
        });
        if (error) throw databaseError(error);
        return response({ ok: true });
      }
      case 'invite': {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const redirect = teamInviteRedirect();
        if (!redirect) throw new WorkspaceError('Configure the CRM activation URL before sending invitations.', 503);
        if (!isUuid(body.id) || !roleId(body.role_id) || !version(body.role_version) || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
          throw new WorkspaceError('Enter a valid email address and choose a role.', 400);
        }
        const exceptions = parseTeamExceptions(body.exceptions);
        const role = await db.from('team_role_bundles').select('grants,version').eq('id', body.role_id).maybeSingle();
        if (role.error) throw databaseError(role.error);
        if (!role.data || role.data.version !== body.role_version) throw new WorkspaceError('This role changed. Reload Team before inviting.', 409);
        validateTeamAccess(resolveTeamAccess(parseTeamGrants(role.data.grants), exceptions));
        const saved = await db.rpc('create_team_invitation', {
          p_actor: actor, p_id: body.id, p_email: email, p_role_id: body.role_id, p_exceptions: body.exceptions,
          p_role_version: body.role_version,
        });
        if (saved.error) throw databaseError(saved.error);
        const invitation: unknown = saved.data;
        if (!isRecord(invitation) || !version(invitation.version)) throw new WorkspaceError('Invitation status could not be verified.', 503);
        if (invitation.state === 'sent') return response({ ok: true });
        if (invitation.state !== 'pending' && invitation.state !== 'delivery_failed') {
          throw new WorkspaceError('This invitation is no longer open. Reload Team.', 409);
        }
        const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo: redirect });
        const failed = invited.error || !invited.data.user;
        const message = 'Could not deliver the invitation. If the email already has a sign-in account, review that account before retrying.';
        const delivery = await db.rpc('record_team_invitation_delivery', {
          p_actor: actor, p_id: body.id, p_user: failed ? null : invited.data.user?.id,
          p_expected_version: invitation.version, p_error: failed ? message : null,
        });
        if (delivery.error) {
          console.error('[team/invite] Could not record invitation outcome', delivery.error.code);
          throw new WorkspaceError('Invitation status could not be saved. Check Team before retrying.', 503);
        }
        if (failed) throw new WorkspaceError(message, 503);
        return response({ ok: true }, 201);
      }
      case 'revoke_invitation': {
        if (!isUuid(body.id) || !version(body.version)) throw new WorkspaceError('Choose an open invitation.', 400);
        const { error } = await db.rpc('revoke_team_invitation', { p_actor: actor, p_id: body.id, p_expected_version: body.version });
        if (error) throw databaseError(error);
        return response({ ok: true });
      }
      default:
        throw new WorkspaceError('Choose a team action.', 400);
    }
  } catch (error) {
    if (error instanceof TeamAccessError) throw new WorkspaceError(error.message, 400);
    throw error;
  }
}
