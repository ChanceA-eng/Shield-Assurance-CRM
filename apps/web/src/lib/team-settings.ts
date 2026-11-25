import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTeamDelegation, TeamAccessError, type TeamAccess } from '@crm/shared';
import type { NextRequest } from 'next/server';
import { accountMailReady, sendAccountMail, sendTeamInviteMail } from './account-mail';
import { accountOrigin, securityLimit } from './account-security';
import { teamInviteRedirect } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { parseTeamProfileGrants } from './team-profile-permissions';
import { databaseError, workspaceBody } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';
import { createHash, randomBytes } from 'node:crypto';

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

export interface TeamPreset {
  id: string;
  name: string;
  grants: TeamAccess;
  active: boolean;
  version: number;
}

export interface TeamSettingsData {
  members: TeamMember[];
  presets: TeamPreset[];
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
  const [roster, audit, presets] = await Promise.all([
    db.from('agency_members').select('user_id,email,role,active,team_name,role_title,direct_grants,setup_state,access_version,invitation_id')
      .order('email').returns<TeamMember[]>(),
    db.from('agency_audit').select('id,created_at,action,target_id')
      .in('action', ['team_profile_invited', 'team_profile_updated', 'team_profile_activated', 'team_setup_email_accepted',
        'team_setup_email_unconfirmed', 'team_profile_revoked', 'team_contact_updated', 'team_reset_email_accepted',
        'team_reset_email_unconfirmed', 'personnel_document_added', 'personnel_document_share', 'personnel_document_unshare',
        'personnel_document_remove', 'personnel_document_removed', 'personnel_document_access_requested'])
      .order('created_at', { ascending: false }).limit(20).returns<TeamSettingsData['activity']>(),
    db.rpc('list_team_profile_presets', { p_actor: actor }),
  ]);
  if (roster.error) throw databaseError(roster.error);
  if (audit.error) throw databaseError(audit.error);
  if (presets.error) throw databaseError(presets.error);
  const rawPresets: unknown = presets.data;
  if (!Array.isArray(rawPresets)) throw new Error('Team presets returned invalid data.');
  const parsedPresets = rawPresets.map((preset: unknown): TeamPreset => {
    if (!isRecord(preset) || !isUuid(preset.id) || typeof preset.name !== 'string'
      || typeof preset.active !== 'boolean' || typeof preset.version !== 'number' || !Number.isInteger(preset.version)) {
      throw new Error('Team presets returned invalid data.');
    }
    return { id: preset.id, name: preset.name, grants: parseTeamProfileGrants(preset.grants), active: preset.active, version: preset.version };
  });
  return { members: roster.data, presets: parsedPresets, activity: audit.data, owner: roster.data.some((row) => row.user_id === actor && row.role === 'owner'),
    managerGrants: roster.data.find((row) => row.user_id === actor)?.direct_grants ?? null,
    invitationIssue: !teamInviteRedirect() ? 'Configure the public CRM activation URL.' : !accountMailReady() ? 'Configure Resend for account email.' : null };
}

export async function readTeamContact(db: SupabaseClient, actor: string, target: string): Promise<unknown> {
  if (!isUuid(target)) throw new WorkspaceError('Choose a valid team member.', 400);
  const result = await db.rpc('read_team_contact', { p_actor: actor, p_target: target });
  if (result.error) throw databaseError(result.error);
  return result.data;
}

export async function writeTeamSettings(request: NextRequest, db: SupabaseClient, actor: string): Promise<void> {
  await requireTeamManager(db, actor);
  const body = await workspaceBody(request);
  const { action } = body;
  if (action === 'preset') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const id = body.id === null ? null : body.id;
    const version = body.version === null ? null : body.version;
    if (!name || name.length > 80 || typeof body.active !== 'boolean'
      || (id !== null && !isUuid(id)) || (id === null && version !== null)
      || (id !== null && (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2147483647))) {
      throw new WorkspaceError('Enter a valid preset name and version.', 400);
    }
    let grants: TeamAccess;
    try { grants = parseTeamProfileGrants(body.grants); }
    catch (error) {
      if (error instanceof TeamAccessError) throw new WorkspaceError(error.message, 400);
      throw error;
    }
    if (!Object.keys(grants).length) throw new WorkspaceError('Choose at least one permission.', 400);
    const saved = await db.rpc('save_team_profile_preset', {
      p_actor: actor, p_id: id, p_name: name, p_grants: grants, p_active: body.active, p_version: version,
    });
    if (saved.error) throw databaseError(saved.error);
    return;
  }
  if (action === 'revoke') {
    if (!isUuid(body.user_id)) throw new WorkspaceError('Choose a pending member.', 400);
    const result = await db.rpc('revoke_team_profile', { p_actor: actor, p_target: body.user_id });
    if (result.error) throw databaseError(result.error);
    return;
  }
  if (action === 'profile') {
    const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (!isUuid(body.user_id) || typeof body.version !== 'number' || !Number.isInteger(body.version)
      || body.version < 1 || body.version > 2147483647 || !name || name.length > 120 || phone.length > 32 || address.length > 300
      || typeof body.phone !== 'string' || typeof body.address !== 'string') {
      throw new WorkspaceError('Enter a name and valid contact details.', 400);
    }
    const result = await db.rpc('save_team_contact', { p_actor: actor, p_target: body.user_id, p_version: body.version,
      p_name: name, p_phone: phone, p_address: address });
    if (result.error) throw databaseError(result.error);
    return;
  }
  if (action === 'reset') {
    if (!isUuid(body.user_id)) throw new WorkspaceError('Choose an active team member.', 400);
    const authorized = await db.rpc('authorize_team_reset', { p_actor: actor, p_target: body.user_id });
    if (authorized.error) throw databaseError(authorized.error);
    if (typeof authorized.data !== 'string' || !authorized.data) throw new WorkspaceError('Account recovery is unavailable.', 503);
    const email = authorized.data;
    await securityLimit(db, 'recovery-email', email, 3);
    await securityLimit(db, 'recovery-total', 'agency', 30);
    const origin = accountOrigin();
    const generated = await db.auth.admin.generateLink({ type: 'recovery', email });
    const token = generated.data.properties?.hashed_token;
    if (generated.error || generated.data.user?.id !== body.user_id || !token) {
      console.error('[team/reset] Could not create recovery link', generated.error?.code);
      throw new WorkspaceError('Could not create a password reset link.', 503);
    }
    const current = await db.rpc('authorize_team_reset', { p_actor: actor, p_target: body.user_id });
    if (current.error) throw databaseError(current.error);
    if (current.data !== email) throw new WorkspaceError('This member changed. Reload Team before retrying.', 409);
    let sent = false;
    try {
      const link = `${origin}/auth/confirm#type=recovery&token_hash=${encodeURIComponent(token)}`;
      await sendAccountMail(email, 'Reset your Shield CRM password',
        `A Team administrator requested a password reset for your Shield CRM account.\n\n${link}\n\nIf you did not expect this, contact your administrator.`, token);
      sent = true;
    } catch { console.error('[team/reset] Resend did not confirm acceptance'); }
    const recorded = await db.rpc('record_team_reset', { p_actor: actor, p_target: body.user_id, p_sent: sent });
    if (recorded.error) throw databaseError(recorded.error);
    if (!sent) throw new WorkspaceError('Delivery could not be confirmed. Retry the password reset.', 503);
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
    if (action === 'invite' && Object.keys(grants).length === 0) {
      throw new WorkspaceError('Choose at least one permission for this member.', 400);
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
    if (generated.error || !recipient) {
      console.error('[team/setup] Could not create invite', generated.error?.code);
      throw new WorkspaceError('Could not create an invitation. Check whether the email already has a sign-in account.', 409);
    }
    const saved = await db.rpc('save_team_profile', { p_actor: actor, p_target: recipient.id, p_email: email,
      p_name: name, p_title: title, p_grants: grants, p_active: false, p_version: null });
    if (saved.error) throw databaseError(saved.error);
    const challenge = await beginSetup(db, actor, recipient.id);
    await deliver(db, actor, recipient.id, email, redirect, challenge);
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
    const challenge = await beginSetup(db, actor, body.user_id);
    await deliver(db, actor, body.user_id, member.data.email, redirect, challenge);
    return;
  }
  throw new WorkspaceError('Choose a Team action.', 400);
}

function readyInviteOrigin(): string {
  const origin = teamInviteRedirect();
  if (!origin || !accountMailReady()) throw new WorkspaceError('Configure the public CRM activation URL and Resend before inviting.', 503);
  return origin;
}

function challengeDigest(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}

async function beginSetup(db: SupabaseClient, actor: string, user: string): Promise<string> {
  const challenge = randomBytes(32).toString('base64url');
  const result = await db.rpc('begin_team_setup', { p_actor: actor, p_target: user, p_digest: challengeDigest(challenge) });
  if (result.error) throw databaseError(result.error);
  return challenge;
}

async function deliver(db: SupabaseClient, actor: string, user: string, email: string, origin: string, challenge: string): Promise<void> {
  let sent = false;
  try { await sendTeamInviteMail(email, origin, user, challenge); sent = true; }
  catch { console.error('[team/setup] Resend did not confirm acceptance'); }
  const result = await db.rpc('finish_team_setup', { p_actor: actor, p_target: user, p_digest: challengeDigest(challenge), p_sent: sent });
  if (result.error) throw databaseError(result.error);
  if (!sent) throw new WorkspaceError('Delivery could not be confirmed. This person has no access; use Resend setup in the roster.', 503);
}
