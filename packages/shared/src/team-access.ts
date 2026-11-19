export const TEAM_SCOPES = ['self', 'assigned', 'agency'] as const;
export type TeamScope = (typeof TEAM_SCOPES)[number];

const recordScopes = ['assigned', 'agency'] as const;
const agencyScope = ['agency'] as const;
const taskScopes = ['self', 'assigned', 'agency'] as const;

export const TEAM_PERMISSIONS = {
  'leads.view': { label: 'View leads', group: 'Leads', scopes: recordScopes },
  'leads.edit': { label: 'Create and edit leads', group: 'Leads', scopes: recordScopes },
  'leads.delete': { label: 'Archive and delete leads', group: 'Leads', scopes: recordScopes },
  'leads.assign': { label: 'Assign leads', group: 'Leads', scopes: agencyScope },
  'leads.import': { label: 'Import leads', group: 'Leads', scopes: agencyScope },
  'leads.export': { label: 'Export leads', group: 'Leads', scopes: recordScopes },
  'leads.prospect': { label: 'Find and acquire prospects', group: 'Leads', scopes: agencyScope },
  'accounts.view': { label: 'View accounts', group: 'Accounts', scopes: recordScopes },
  'accounts.edit': { label: 'Create and edit accounts', group: 'Accounts', scopes: recordScopes },
  'accounts.delete': { label: 'Delete accounts', group: 'Accounts', scopes: recordScopes },
  'accounts.assign': { label: 'Assign accounts', group: 'Accounts', scopes: agencyScope },
  'accounts.export': { label: 'Export accounts', group: 'Accounts', scopes: recordScopes },
  'policies.view': { label: 'View policies and service work', group: 'Policies', scopes: recordScopes },
  'policies.edit': { label: 'Manage policies and service work', group: 'Policies', scopes: recordScopes },
  'policies.delete': { label: 'Delete policy records', group: 'Policies', scopes: recordScopes },
  'policies.export': { label: 'Export policy records', group: 'Policies', scopes: recordScopes },
  'documents.view': { label: 'View customer documents', group: 'Documents', scopes: recordScopes },
  'documents.edit': { label: 'Upload customer documents', group: 'Documents', scopes: recordScopes },
  'documents.delete': { label: 'Delete customer documents', group: 'Documents', scopes: recordScopes },
  'intake.manage': { label: 'Request secure intake', group: 'Documents', scopes: recordScopes },
  'messages.view': { label: 'View customer conversations', group: 'Communication', scopes: recordScopes },
  'messages.send': { label: 'Send customer messages', group: 'Communication', scopes: recordScopes },
  'campaigns.view': { label: 'View outreach campaigns', group: 'Communication', scopes: agencyScope },
  'campaigns.send': { label: 'Manage and send outreach campaigns', group: 'Communication', scopes: agencyScope },
  'tasks.view': { label: 'View tasks', group: 'Tasks and calendar', scopes: taskScopes },
  'tasks.edit': { label: 'Manage tasks', group: 'Tasks and calendar', scopes: taskScopes },
  'tasks.assign': { label: 'Assign other members tasks', group: 'Tasks and calendar', scopes: agencyScope },
  'calendar.view': { label: 'View calendar', group: 'Tasks and calendar', scopes: taskScopes },
  'calendar.edit': { label: 'Manage calendar', group: 'Tasks and calendar', scopes: taskScopes },
  'dashboard.view': { label: 'View CRM dashboard', group: 'Reports', scopes: recordScopes },
  'reports.view': { label: 'View agency reports', group: 'Reports', scopes: agencyScope },
  'reports.export': { label: 'Export agency reports', group: 'Reports', scopes: agencyScope },
  'content.view': { label: 'View reusable copy and templates', group: 'Content', scopes: agencyScope },
  'content.edit': { label: 'Edit reusable copy and templates', group: 'Content', scopes: agencyScope },
  'content.delete': { label: 'Delete reusable content', group: 'Content', scopes: agencyScope },
  'social.view': { label: 'View social content and marketing assets', group: 'Social', scopes: agencyScope },
  'social.edit': { label: 'Create and edit social content and media', group: 'Social', scopes: agencyScope },
  'social.delete': { label: 'Delete social drafts and media', group: 'Social', scopes: agencyScope },
  'social.approve': { label: 'Approve social content', group: 'Social', scopes: agencyScope },
  'social.publish': { label: 'Publish approved social content', group: 'Social', scopes: agencyScope },
  'social.publish_direct': { label: 'Publish without review using checklist', group: 'Social', scopes: agencyScope },
  'social.connections': { label: 'Connect and manage social accounts', group: 'Social', scopes: agencyScope },
  'knowledge.view': { label: 'View knowledge and training', group: 'Knowledge', scopes: agencyScope },
  'knowledge.edit': { label: 'Manage knowledge and training', group: 'Knowledge', scopes: agencyScope },
  'automation.view': { label: 'View agency automation', group: 'Administration', scopes: agencyScope },
  'automation.manage': { label: 'Manage agency automation', group: 'Administration', scopes: agencyScope },
  'integrations.manage': { label: 'Manage agency integrations', group: 'Administration', scopes: agencyScope },
  'agency.manage': { label: 'Manage agency identity and settings', group: 'Administration', scopes: agencyScope },
  'team.manage': { label: 'Invite and manage team access', group: 'Administration', scopes: agencyScope },
} as const;

export type TeamPermission = keyof typeof TEAM_PERMISSIONS;
export interface TeamGrant { permission: TeamPermission; scope: TeamScope }
export type TeamException =
  | { permission: TeamPermission; effect: 'allow'; scope: TeamScope }
  | { permission: TeamPermission; effect: 'deny'; scope?: never };
export type TeamAccess = Readonly<Partial<Record<TeamPermission, TeamScope>>>;
export interface TeamRoleBundle {
  id: string;
  name: string;
  version: number;
  grants: readonly TeamGrant[];
}

export const TEAM_PERMISSION_DEPENDENCIES: Readonly<Partial<Record<TeamPermission, readonly TeamPermission[]>>> = {
  'leads.edit': ['leads.view'], 'leads.delete': ['leads.edit'],
  'leads.assign': ['leads.edit'], 'leads.import': ['leads.edit'],
  'leads.export': ['leads.view'], 'leads.prospect': ['leads.edit'],
  'accounts.edit': ['accounts.view'], 'accounts.delete': ['accounts.edit'],
  'accounts.assign': ['accounts.edit'], 'accounts.export': ['accounts.view'],
  'policies.edit': ['policies.view', 'accounts.view'], 'policies.delete': ['policies.edit'],
  'policies.export': ['policies.view'],
  'documents.edit': ['documents.view'], 'documents.delete': ['documents.edit'],
  'messages.send': ['messages.view'],
  'campaigns.send': ['campaigns.view', 'leads.view', 'messages.send'],
  'tasks.edit': ['tasks.view'], 'tasks.assign': ['tasks.edit'],
  'calendar.edit': ['calendar.view'],
  'reports.export': ['reports.view'],
  'content.edit': ['content.view'], 'content.delete': ['content.edit'],
  'social.edit': ['social.view'], 'social.delete': ['social.edit'],
  'social.approve': ['social.view'], 'social.publish': ['social.view'],
  'social.publish_direct': ['social.publish'], 'social.connections': ['social.view'],
  'knowledge.edit': ['knowledge.view'], 'automation.manage': ['automation.view'],
};

const scopeRank: Readonly<Record<TeamScope, number>> = { self: 1, assigned: 2, agency: 3 };
export class TeamAccessError extends Error {
  constructor(message: string) { super(message); this.name = 'TeamAccessError'; }
}

export function isTeamPermission(value: unknown): value is TeamPermission {
  return typeof value === 'string' && Object.hasOwn(TEAM_PERMISSIONS, value);
}

export function isTeamScope(value: unknown): value is TeamScope {
  return value === 'self' || value === 'assigned' || value === 'agency';
}

function inputObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TeamAccessError(message);
  return Object.fromEntries(Object.entries(value));
}

export function parseTeamGrants(value: unknown): TeamGrant[] {
  const input = inputObject(value, 'Choose valid role permissions.');
  const grants = Object.entries(input).map(([permission, scope]): TeamGrant => {
    if (!isTeamPermission(permission) || !isTeamScope(scope)) throw new TeamAccessError('Choose a known permission and scope.');
    assertGrant(permission, scope);
    return { permission, scope };
  });
  validateTeamAccess(resolveTeamAccess(grants));
  return grants;
}

export function parseTeamExceptions(value: unknown): TeamException[] {
  const input = inputObject(value, 'Choose valid member exceptions.');
  return Object.entries(input).map(([permission, raw]): TeamException => {
    if (!isTeamPermission(permission)) throw new TeamAccessError('Choose a known permission.');
    const exception = inputObject(raw, 'Choose allow or deny for this exception.');
    if (exception.effect === 'deny' && Object.keys(exception).length === 1) return { permission, effect: 'deny' };
    if (exception.effect === 'allow' && isTeamScope(exception.scope) && Object.keys(exception).length === 2) {
      assertGrant(permission, exception.scope);
      return { permission, effect: 'allow', scope: exception.scope };
    }
    throw new TeamAccessError('Choose allow with a valid scope, or deny without a scope.');
  });
}

export function teamScopeIncludes(ceiling: TeamScope, requested: TeamScope): boolean {
  return scopeRank[ceiling] >= scopeRank[requested];
}

function assertGrant(permission: TeamPermission, scope: TeamScope): void {
  const allowed: readonly TeamScope[] = TEAM_PERMISSIONS[permission].scopes;
  if (!allowed.includes(scope)) throw new TeamAccessError(`Choose a valid scope for ${TEAM_PERMISSIONS[permission].label}.`);
}

export function resolveTeamAccess(grants: readonly TeamGrant[], exceptions: readonly TeamException[] = []): TeamAccess {
  const result: Partial<Record<TeamPermission, TeamScope>> = {};
  const seen = new Set<TeamPermission>();
  for (const grant of grants) {
    assertGrant(grant.permission, grant.scope);
    if (seen.has(grant.permission)) throw new TeamAccessError('A role cannot contain duplicate permissions.');
    seen.add(grant.permission);
    result[grant.permission] = grant.scope;
  }
  seen.clear();
  for (const exception of exceptions) {
    if (seen.has(exception.permission)) throw new TeamAccessError('Choose one exception per permission.');
    seen.add(exception.permission);
    if (exception.effect === 'deny') delete result[exception.permission];
    else {
      assertGrant(exception.permission, exception.scope);
      result[exception.permission] = exception.scope;
    }
  }
  return result;
}

export function validateTeamAccess(access: TeamAccess): void {
  for (const permission of Object.keys(TEAM_PERMISSIONS) as TeamPermission[]) {
    const scope = access[permission];
    if (!scope) continue;
    assertGrant(permission, scope);
    for (const dependency of TEAM_PERMISSION_DEPENDENCIES[permission] ?? []) {
      const available = access[dependency];
      if (!available || !teamScopeIncludes(available, scope)) {
        throw new TeamAccessError(`${TEAM_PERMISSIONS[permission].label} requires ${TEAM_PERMISSIONS[dependency].label} at the same or wider scope.`);
      }
    }
  }
}

export function assertTeamDelegation(ceiling: TeamAccess, access: TeamAccess): void {
  validateTeamAccess(access);
  for (const permission of Object.keys(TEAM_PERMISSIONS) as TeamPermission[]) {
    const requested = access[permission];
    const available = ceiling[permission];
    if (requested && (!available || !teamScopeIncludes(available, requested))) {
      throw new TeamAccessError(`You cannot grant ${TEAM_PERMISSIONS[permission].label} beyond your own access.`);
    }
  }
}

export function hasTeamPermission(access: TeamAccess, permission: TeamPermission, scope: TeamScope): boolean {
  const available = access[permission];
  return available !== undefined && teamScopeIncludes(available, scope);
}

const grant = (permission: TeamPermission, scope: TeamScope = 'agency'): TeamGrant => ({ permission, scope });
const customerWork: TeamGrant[] = [
  grant('accounts.view'), grant('accounts.edit'), grant('policies.view'), grant('policies.edit'),
  grant('documents.view'), grant('documents.edit'), grant('intake.manage'),
  grant('messages.view'), grant('messages.send'), grant('tasks.view'), grant('tasks.edit'),
  grant('calendar.view'), grant('calendar.edit'), grant('dashboard.view'), grant('knowledge.view'),
];
const contentWork: TeamGrant[] = [
  grant('content.view'), grant('content.edit'), grant('social.view'), grant('social.edit'),
  grant('tasks.view', 'self'), grant('tasks.edit', 'self'),
];

export const STARTER_TEAM_ROLES: readonly TeamRoleBundle[] = [
  { id: 'admin', name: 'Admin', version: 1, grants: (Object.keys(TEAM_PERMISSIONS) as TeamPermission[]).map((permission) => grant(permission)) },
  { id: 'producer', name: 'Producer', version: 1, grants: [
    ...customerWork, grant('leads.view'), grant('leads.edit'), grant('leads.prospect'), grant('content.view'),
  ] },
  { id: 'account-service', name: 'Account service', version: 1, grants: customerWork },
  { id: 'social-marketer', name: 'Social marketer', version: 1, grants: contentWork },
  { id: 'content-writer', name: 'Content writer', version: 1, grants: contentWork },
  { id: 'read-only-reviewer', name: 'Read-only reviewer', version: 1, grants: [grant('content.view'), grant('social.view')] },
];

export const SOCIAL_PUBLISH_CHECKLIST_VERSION = 1;
export const SOCIAL_PUBLISH_CHECKLIST = {
  destination: 'The destination account is correct.',
  content: 'I checked the final text and media.',
  compliance: 'The content is accurate and meets our compliance requirements.',
  rights: 'We may use these assets and they contain no private customer information.',
} as const;
export type SocialPublishChecklistItem = keyof typeof SOCIAL_PUBLISH_CHECKLIST;
export interface SocialPublishConfirmation {
  checklist_version: number;
  checks: Record<SocialPublishChecklistItem, boolean>;
  post_id: string;
  revision: number;
  connection_id: string;
}

export function validateSocialPublishConfirmation(value: unknown): SocialPublishConfirmation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TeamAccessError('Complete the publishing checklist.');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const keys = ['checklist_version', 'checks', 'post_id', 'revision', 'connection_id'];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Object.keys(input).some((key) => !keys.includes(key))
    || input.checklist_version !== SOCIAL_PUBLISH_CHECKLIST_VERSION
    || typeof input.post_id !== 'string' || !uuid.test(input.post_id)
    || typeof input.connection_id !== 'string' || !uuid.test(input.connection_id)
    || typeof input.revision !== 'number' || !Number.isInteger(input.revision) || input.revision < 1 || input.revision >= 2147483647
    || !input.checks || typeof input.checks !== 'object' || Array.isArray(input.checks)) {
    throw new TeamAccessError('Reload the final post and complete its publishing checklist.');
  }
  const checks: Record<string, unknown> = Object.fromEntries(Object.entries(input.checks));
  const items = Object.keys(SOCIAL_PUBLISH_CHECKLIST) as SocialPublishChecklistItem[];
  if (Object.keys(checks).length !== items.length || items.some((item) => checks[item] !== true)) {
    throw new TeamAccessError('Confirm every publishing checklist item.');
  }
  return {
    checklist_version: SOCIAL_PUBLISH_CHECKLIST_VERSION,
    checks: { destination: true, content: true, compliance: true, rights: true },
    post_id: input.post_id, revision: input.revision, connection_id: input.connection_id,
  };
}
