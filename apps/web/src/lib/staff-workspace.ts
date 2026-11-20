import type { RequestAccess } from './team-request-access';

export const STAFF_WORKSPACE_HEADER = 'x-crm-staff-workspace';
export const STAFF_TEAM_ACCESS_HEADER = 'x-crm-team-access';
export type StaffWorkspace = 'full' | 'account' | 'social-reader' | 'social-editor';

export function staffWorkspace(access: RequestAccess): StaffWorkspace {
  if (access.mode === 'legacy') return 'full';
  if (access.grants['social.view'] !== 'agency') return 'account';
  return access.grants['social.edit'] === 'agency' ? 'social-editor' : 'social-reader';
}

export function readStaffWorkspace(value: string | null): StaffWorkspace {
  return value === 'full' || value === 'social-reader' || value === 'social-editor' ? value : 'account';
}

export function readStaffTeamAccess(value: string | null): RequestAccess {
  if (!value) return { mode: 'restricted', grants: {} };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && 'mode' in parsed && parsed.mode === 'restricted'
      && 'grants' in parsed && parsed.grants && typeof parsed.grants === 'object' && !Array.isArray(parsed.grants)) {
      return { mode: 'restricted', grants: Object.fromEntries(Object.entries(parsed.grants)) };
    }
  } catch (error) {
    console.error('[staff-workspace] Invalid middleware access header.', error);
  }
  return { mode: 'restricted', grants: {} };
}
export const POLICY_ADMIN_HEADER = 'x-crm-policy-admin';
export const TEAM_MANAGER_HEADER = 'x-crm-team-manager';
export const STAFF_TRAINING_HEADER = 'x-crm-staff-training';
