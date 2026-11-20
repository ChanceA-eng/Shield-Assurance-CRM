import { TEAM_PERMISSIONS, parseTeamGrants, resolveTeamAccess, type TeamAccess, type TeamPermission } from '@crm/shared';

export const TEAM_PROFILE_PERMISSIONS = Object.fromEntries(
  (Object.keys(TEAM_PERMISSIONS) as TeamPermission[]).map((permission) => [permission, TEAM_PERMISSIONS[permission].label]),
) as Readonly<Record<TeamPermission, string>>;

export function parseTeamProfileGrants(value: unknown): TeamAccess {
  return resolveTeamAccess(parseTeamGrants(value));
}
