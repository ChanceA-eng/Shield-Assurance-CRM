import type { TeamPermission, TeamScope } from '@crm/shared';
import type { RequestAccess } from './team-request-access';

export interface TeamPageRequirement {
  permissions: readonly TeamPermission[];
  scope: TeamScope;
  mode?: 'all' | 'any';
}

const pageRules: ReadonlyArray<{ test: (pathname: string) => boolean; permissions: readonly TeamPermission[]; scope?: TeamScope; mode?: 'all' | 'any' }> = [
  { test: (path) => path === '/account', permissions: [] },
  { test: (path) => path === '/', permissions: ['dashboard.view'], scope: 'agency' },
  { test: (path) => path === '/settings', permissions: ['team.manage'] },
  { test: (path) => path.startsWith('/settings/'), permissions: ['agency.manage'] },
  { test: (path) => path.startsWith('/leads/finder'), permissions: ['leads.prospect'], scope: 'agency' },
  { test: (path) => path.startsWith('/leads/import'), permissions: ['leads.import'], scope: 'agency' },
  { test: (path) => path.startsWith('/leads'), permissions: ['leads.view'], scope: 'assigned' },
  { test: (path) => path.startsWith('/clients'), permissions: ['accounts.view'], scope: 'assigned' },
  { test: (path) => ['/policies', '/renewals', '/claims', '/endorsements', '/certificates', '/workers-comp'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    permissions: ['policies.view', 'accounts.view'], scope: 'assigned', mode: 'all' },
  { test: (path) => path === '/tasks' || path.startsWith('/tasks/'), permissions: ['tasks.view'], scope: 'self' },
  { test: (path) => path === '/workday', permissions: ['tasks.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/scheduler'), permissions: ['calendar.view'] },
  { test: (path) => path.startsWith('/communication/social'), permissions: ['social.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/communication'), permissions: ['messages.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/outreach/campaigns') || path.startsWith('/outreach/enrollments'), permissions: ['campaigns.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/outreach'), permissions: ['automation.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/reports'), permissions: ['reports.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/learning/course-builder'), permissions: ['knowledge.edit'], scope: 'agency' },
  { test: (path) => path.startsWith('/learning'), permissions: ['knowledge.view'], scope: 'agency' },
  { test: (path) => path.startsWith('/rashi'), permissions: ['knowledge.view'], scope: 'agency' },
];

export function teamPageRequirement(pathname: string, search = ''): TeamPageRequirement | null {
  if (pathname === '/settings') {
    const tab = new URLSearchParams(search).get('tab') ?? 'team';
    const permission: TeamPermission | null = tab === 'email' || tab === 'integrations' ? 'integrations.manage'
      : tab === 'automation' || tab === 'operations' || tab === 'outreach' ? 'automation.view'
        : tab === 'intelligence' ? 'leads.prospect' : tab === 'permissions' ? 'agency.manage'
          : tab === 'team' ? 'team.manage' : null;
    return permission ? { permissions: [permission], scope: 'agency' } : null;
  }
  const rule = pageRules.find(({ test }) => test(pathname));
  if (!rule) return null;
  return { permissions: rule.permissions, scope: rule.scope ?? 'agency', mode: rule.mode };
}

export function canAccessTeamPage(access: RequestAccess, pathname: string, search = ''): boolean {
  if (access.mode === 'legacy') return true;
  const requirement = teamPageRequirement(pathname, search);
  if (!requirement) return false;
  if (!requirement.permissions.length) return true;
  const allowed = requirement.permissions.map((permission) => {
    const scope = access.grants[permission];
    if (scope !== 'agency' && scope !== 'assigned' && scope !== 'self') return false;
    if (requirement.scope === 'agency') return scope === 'agency';
    return requirement.scope === 'assigned' ? scope === 'agency' || scope === 'assigned'
      : scope === 'agency' || scope === 'assigned' || scope === 'self';
  });
  return requirement.mode === 'all' ? allowed.every(Boolean) : allowed.some(Boolean);
}
