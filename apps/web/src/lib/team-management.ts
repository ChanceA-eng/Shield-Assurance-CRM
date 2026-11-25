import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { WorkspaceError } from './record-scope';
import { databaseError, workspaceBody } from './workspace-api';
import { createHash } from 'node:crypto';

const response = (data: unknown): NextResponse => NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });

export async function activateTeamMember(request: NextRequest, db: SupabaseClient, actor: string): Promise<NextResponse> {
  const setup = await db.from('agency_members').select('setup_state,active').eq('user_id', actor).maybeSingle();
  if (setup.error && !['42703', 'PGRST204'].includes(setup.error.code)) throw databaseError(setup.error);
  if (setup.data?.setup_state) {
    if (setup.data.setup_state === 'accepted' && setup.data.active) {
      if (request.method === 'GET') return response({ needsActivation: false });
      throw new WorkspaceError('This setup has already been completed.', 409);
    }
    if (setup.data.setup_state !== 'sent') throw new WorkspaceError('This setup link is not available. Ask a Team administrator for help.', 403);
    if (request.method === 'GET') return response({ needsActivation: true, challengeRequired: true });
    const body = await workspaceBody(request);
    if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) {
      throw new WorkspaceError('This setup link is unavailable. Ask your administrator for a new link.', 403);
    }
    const digest = createHash('sha256').update(body.challenge).digest('hex');
    if (body.action === 'verify') {
      const verified = await db.rpc('verify_team_setup', { p_actor: actor, p_digest: digest });
      if (verified.error) throw databaseError(verified.error);
      return response({ ok: true });
    }
    if (body.action !== 'complete' || typeof body.phone !== 'string' || body.phone.trim().length < 7
      || body.phone.trim().length > 32 || (body.address !== undefined
        && (typeof body.address !== 'string' || body.address.trim().length > 300))) {
      throw new WorkspaceError('Enter a phone number and an optional mailing address.', 400);
    }
    const accepted = await db.rpc('complete_team_setup', { p_actor: actor, p_digest: digest,
      p_phone: body.phone.trim(), p_address: typeof body.address === 'string' ? body.address.trim() : null });
    if (accepted.error) throw databaseError(accepted.error);
    return response({ ok: true });
  }
  const member = await db.from('agency_members').select('active,invitation_id').eq('user_id', actor).maybeSingle();
  if (member.error?.code === '42703' || member.error?.code === 'PGRST204') {
    const legacy = await db.from('agency_members').select('active').eq('user_id', actor).maybeSingle();
    if (legacy.error) throw databaseError(legacy.error);
    if (request.method === 'GET' && legacy.data?.active) return response({ needsActivation: false });
  } else if (member.error) throw databaseError(member.error);
  if (request.method === 'GET' && member.data?.active) return response({ needsActivation: false });
  if (!member.data?.invitation_id) throw new WorkspaceError('An active invitation is required.', 403);
  const rollout = await db.from('team_access_rollout').select('enabled,enforcement_version').eq('singleton', true).single();
  if (rollout.error) throw databaseError(rollout.error);
  if (!rollout.data.enabled || rollout.data.enforcement_version < 1) throw new WorkspaceError('An active invitation is required.', 403);
  const invitation = await db.from('team_invitations').select('state').eq('id', member.data.invitation_id).eq('user_id', actor).maybeSingle();
  if (invitation.error) throw databaseError(invitation.error);
  if (invitation.data?.state !== 'sent' && !(invitation.data?.state === 'accepted' && member.data.active)) {
    throw new WorkspaceError('This invitation is not available. Ask the owner for access.', 403);
  }
  if (request.method === 'GET') return response({ needsActivation: true });
  const result = await db.rpc('accept_team_invitation', { p_user: actor, p_id: member.data.invitation_id });
  if (result.error) throw databaseError(result.error);
  if (result.data?.user_id !== actor) throw new WorkspaceError('Team activation could not be verified.', 503);
  return response({ ok: true });
}
