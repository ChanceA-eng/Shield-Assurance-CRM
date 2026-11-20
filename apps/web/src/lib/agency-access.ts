import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgencyMember } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { requireTeamPermission, type RequestAccess } from './team-request-access';

export async function accountMembership(db: SupabaseClient, userId: string): Promise<AgencyMember | null> {
  const { data, error } = await db.from('agency_members')
    .select('user_id,email,role,active,sender_profile,gmail_ai_opt_in')
    .eq('user_id', userId).maybeSingle<AgencyMember>();
  if (error) throw databaseError(error);
  return data;
}

export async function requireAgencyOwner(db: SupabaseClient, userId: string): Promise<AgencyMember> {
  const member = await accountMembership(db, userId);
  if (!member?.active || member.role !== 'owner') {
    throw new WorkspaceError('Only the agency owner can change agency settings. Your personal preferences are in My Account.', 403);
  }
  return member;
}

export function requireAgencyReportsAccess(access: RequestAccess | undefined): void {
  requireTeamPermission(access, 'reports.view');
}
