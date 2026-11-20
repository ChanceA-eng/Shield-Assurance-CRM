import { parseTeamGrants, resolveTeamAccess, TeamAccessError, type TeamAccess } from '@crm/shared';

export const TEAM_PROFILE_PERMISSIONS = {
  'leads.view': 'View leads',
  'accounts.view': 'View accounts',
  'accounts.edit': 'Edit account details',
  'policies.view': 'View policies',
  'policies.edit': 'Request policy changes',
  'documents.view': 'View and download account documents',
  'documents.edit': 'Upload account documents',
  'social.view': 'View social marketing',
  'social.edit': 'Edit social drafts and media',
  'team.manage': 'Manage team access',
} as const;

export function parseTeamProfileGrants(value: unknown): TeamAccess {
  const grants = parseTeamGrants(value);
  if (grants.some(({ permission }) => !Object.hasOwn(TEAM_PROFILE_PERMISSIONS, permission))) {
    throw new TeamAccessError('Choose only permissions supported by the staff workspace.');
  }
  return resolveTeamAccess(grants);
}
