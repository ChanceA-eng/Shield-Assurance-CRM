import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTeamDelegation, TeamAccessError, type TeamAccess } from '@crm/shared';
import type { NextRequest } from 'next/server';
import { accountMailReady, sendTeamInviteMail } from './account-mail';
import { teamInviteRedirect } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { parseTeamProfileGrants } from './team-profile-permissions';
import { databaseError, workspaceBody } from './workspace-api';
import { isUuid } from './workspace-validation';

export interface TeamMember {
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'agent';
  active: boolean;
  team_name: string | null;
  role_title: string | null;
  direct_grants: TeamAccess | null;
  setup_state: 'pending' | 'delivery_failed' | 'sent' | 'accepted' | 'revoked' | null;
  access_version: number;
  invitation_id: string | null;
}

export interface TeamSettingsData {
  members: TeamMember[];
  owner: boolean;
  managerGrants: TeamAccess | null;
  invitationIssue: string | null;
  activity: { id: string; created_at: string; action: string; target_id: string }[];
}

async function requireTeamManager(db: SupabaseClient, actor: string): Promise<void> {
  const result = await db.rpc('team_profile_manager', { p_actor: actor });
  if (result.error) throw databaseError(result.error);
  if (result.data !== true) throw new WorkspaceError('Team administration is required.', 403);
}

export async function readTeamSettings(db: SupabaseClient, actor: string): Promise<TeamSettingsData> {
  await requireTeamManager(db, actor);
  const [roster, audit] = await Promise.all([
    db.from('agency_members').select('user_id,email,role,active,team_name,role_title,direct_grants,setup_state,access_version,invitation_id')
      .order('email').returns<TeamMember[]>(),
    db.from('agency_audit').select('id,created_at,action,target_id')
      .in('action', ['team_profile_invited', 'team_profile_updated', 'team_profile_activated', 'team_setup_email_accepted', 'team_setup_email_unconfirmed', 'team_profile_revoked'])
      .order('created_at', { ascending: false }).limit(20).returns<TeamSettingsData['activity']>(),
  ]);
  if (roster.error) throw databaseError(roster.error);
  if (audit.error) throw databaseError(audit.error);
  return { members: roster.data, activity: audit.data, owner: roster.data.some((row) => row.user_id === actor && row.role === 'owner'),
    managerGrants: roster.data.find((row) => row.user_id === actor)?.direct_grants ?? null,
    invitationIssue: !teamInviteRedirect() ? 'Configure the public CRM activation URL.' : !accountMailReady() ? 'Configure Resend for account email.' : null };
}

export async function writeTeamSettings(request: NextRequest, db: SupabaseClient, actor: string): Promise<void> {
  await requireTeamManager(db, actor);
  const body = await workspaceBody(request);
  const { action } = body;
  if (action === 'revoke') {
    if (!isUuid(body.user_id)) throw new WorkspaceError('Choose a pending member.', 400);
    const result = await db.rpc('revoke_team_profile', { p_actor: actor, p_target: body.user_id });
    if (result.error) throw databaseError(result.error);
    return;
  }
  if (action === 'edit' || action === 'invite') {
    const title = typeof body.role_title === 'string' ? body.role_title.trim() : '';
    if (!title || title.length > 80) throw new WorkspaceError('Enter a role title of up to 80 characters.', 400);
    let grants: TeamAccess;
    try { grants = parseTeamProfileGrants(body.grants); }
    catch (error) {
      if (error instanceof TeamAccessError) throw new WorkspaceError(error.message, 400);
      throw error;
    }
    if (action === 'edit') {
      if (!isUuid(body.user_id) || typeof body.active !== 'boolean' || typeof body.version !== 'number'
        || !Number.isInteger(body.version) || body.version < 1 || body.version > 2147483647) {
        throw new WorkspaceError('Choose a member and access status.', 400);
      }
      const saved = await db.rpc('save_team_profile', { p_actor: actor, p_target: body.user_id, p_email: null,
        p_name: null, p_title: title, p_grants: grants, p_active: body.active, p_version: body.version });
      if (saved.error) throw databaseError(saved.error);
      return;
    }
    const redirect = readyInviteOrigin();
    const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!name || name.length > 120 || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      throw new WorkspaceError('Enter a name and a valid email address.', 400);
    }
    const existing = await db.from('agency_members').select('user_id').eq('email', email).maybeSingle();
    if (existing.error) throw databaseError(existing.error);
    if (existing.data) throw new WorkspaceError('This person already has a team profile. Manage it in the roster.', 409);
    const manager = await db.from('agency_members').select('direct_grants').eq('user_id', actor).single();
    if (manager.error) throw databaseError(manager.error);
    if (manager.data.direct_grants !== null) {
      try { assertTeamDelegation(parseTeamProfileGrants(manager.data.direct_grants), grants); }
      catch (error) {
        if (error instanceof TeamAccessError) throw new WorkspaceError(error.message, 403);
        throw error;
      }
    }
    const generated = await db.auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name: name } } });
    const recipient = generated.data.user;
    const token = generated.data.properties?.hashed_token;
    if (generated.error || !recipient || !token) {
      console.error('[team/setup] Could not create invite', generated.error?.code);
      throw new WorkspaceError('Could not create an invitation. Check whether the email already has a sign-in account.', 409);
    }
    const saved = await db.rpc('save_team_profile', { p_actor: actor, p_target: recipient.id, p_email: email,
      p_name: name, p_title: title, p_grants: grants, p_active: false, p_version: null });
    if (saved.error) throw databaseError(saved.error);
    await deliver(db, actor, recipient.id, email, redirect, token, 'invite');
    return;
  }
  if (action === 'resend') {
    const redirect = readyInviteOrigin();
    if (!isUuid(body.user_id)) throw new WorkspaceError('Choose a pending team member.', 400);
    const member = await db.from('agency_members').select('email,setup_state,direct_grants').eq('user_id', body.user_id).maybeSingle();
    if (member.error) throw databaseError(member.error);
    if (!member.data || !['pending', 'delivery_failed', 'sent'].includes(member.data.setup_state)) {
      throw new WorkspaceError('Choose a pending team member.', 409);
    }
    const manager = await db.from('agency_members').select('direct_grants').eq('user_id', actor).single();
    if (manager.error) throw databaseError(manager.error);
    if (manager.data.direct_grants !== null) {
      try { assertTeamDelegation(parseTeamProfileGrants(manager.data.direct_grants), parseTeamProfileGrants(member.data.direct_grants)); }
      catch (error) {
        if (error instanceof TeamAccessError) throw new WorkspaceError(error.message, 403);
        throw error;
      }
    }
    const generated = await db.auth.admin.generateLink({ type: 'recovery', email: member.data.email });
    const token = generated.data.properties?.hashed_token;
    if (generated.error || generated.data.user?.id !== body.user_id || !token) {
      console.error('[team/setup] Could not create a replacement link', generated.error?.code);
      throw new WorkspaceError('Could not create a replacement setup link.', 503);
    }
    await deliver(db, actor, body.user_id, member.data.email, redirect, token, 'recovery');
    return;
  }
  throw new WorkspaceError('Choose a Team action.', 400);
}

function readyInviteOrigin(): string {
  const origin = teamInviteRedirect();
  if (!origin || !accountMailReady()) throw new WorkspaceError('Configure the public CRM activation URL and Resend before inviting.', 503);
  return origin;
}

async function deliver(db: SupabaseClient, actor: string, user: string, email: string, origin: string, token: string,
  type: 'invite' | 'recovery'): Promise<void> {
  let sent = false;
  try { await sendTeamInviteMail(email, origin, token, type); sent = true; }
  catch { console.error('[team/setup] Resend did not confirm acceptance'); }
  const result = await db.rpc('record_team_setup_email', { p_actor: actor, p_target: user, p_sent: sent });
  if (result.error) throw databaseError(result.error);
  if (!sent) throw new WorkspaceError('Delivery could not be confirmed. This person has no access; use Resend setup in the roster.', 503);
}
