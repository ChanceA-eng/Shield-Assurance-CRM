import type { RequestAccess } from './team-request-access';

export const STAFF_WORKSPACE_HEADER = 'x-crm-staff-workspace';
export type StaffWorkspace = 'full' | 'account' | 'social-reader' | 'social-editor';

export function staffWorkspace(access: RequestAccess): StaffWorkspace {
  if (access.mode === 'legacy') return 'full';
  if (access.grants['social.view'] !== 'agency') return 'account';
  return access.grants['social.edit'] === 'agency' ? 'social-editor' : 'social-reader';
}

export function readStaffWorkspace(value: string | null): StaffWorkspace {
  return value === 'full' || value === 'social-reader' || value === 'social-editor' ? value : 'account';
}
export const POLICY_ADMIN_HEADER = 'x-crm-policy-admin';
