import type { SupabaseClient } from '@supabase/supabase-js';
import { teamApiRoutePolicy } from './team-route-policy';
import { staffRecords, staffRecordScope, visibleStaffRecords } from './staff-records';
import { canAccessTeamPage } from './team-page-access';
import type { TeamPermission, TeamScope } from '@crm/shared';
import { WorkspaceError } from './record-scope';

type Grants = Readonly<Record<string, unknown>>;
export type RequestAccess = ({ mode: 'legacy' } | { mode: 'restricted'; grants: Grants }) & {
  policyAdmin?: boolean;
  verifiedOwnerFallback?: true;
};

export function hasTeamPermission(access: RequestAccess | undefined, permission: TeamPermission, requiredScope: TeamScope = 'agency'): boolean {
  if (access?.mode === 'legacy') return true;
  if (access?.mode !== 'restricted') return false;
  const actual = access.grants[permission];
  if (actual !== 'agency' && actual !== 'assigned' && actual !== 'self') return false;
  if (requiredScope === 'agency') return actual === 'agency';
  if (requiredScope === 'assigned') return actual === 'assigned' || actual === 'agency';
  return true;
}

export function requireTeamPermission(access: RequestAccess | undefined, permission: TeamPermission, requiredScope: TeamScope = 'agency'): void {
  if (!hasTeamPermission(access, permission, requiredScope)) {
    throw new WorkspaceError(`The ${permission} permission is required.`, 403);
  }
}

export function accountRecordScope(
  access: RequestAccess | undefined,
  action: 'accounts.view' | 'accounts.edit' | 'documents.view' | 'documents.edit' | 'documents.delete',
): 'agency' | 'assigned' | null {
  if (access?.mode === 'legacy') return 'agency';
  if (access?.mode !== 'restricted') return null;
  const account = access.grants['accounts.view'];
  const operation = access.grants[action];
  if ((account !== 'agency' && account !== 'assigned') || (operation !== 'agency' && operation !== 'assigned')) return null;
  return account === 'assigned' || operation === 'assigned' ? 'assigned' : 'agency';
}

export function accountDocumentReadScope(access?: RequestAccess): 'agency' | 'assigned' | null {
  return accountRecordScope(access, 'documents.view');
}

export async function readTeamRequestAccess(auth: SupabaseClient, userId: string): Promise<RequestAccess> {
  const { data: result, error } = await auth.rpc('team_request_access');
  if (error?.code === 'PGRST202') {
    // The existing self-read policy exposes only the signed-in member's active row.
    const owner = await auth.from('agency_members').select('user_id')
      .eq('user_id', userId).eq('role', 'owner').eq('active', true).maybeSingle();
    if (!owner.error && owner.data?.user_id === userId) return { mode: 'legacy', verifiedOwnerFallback: true };
  }
  const data: unknown = result;
  if (error || !data || typeof data !== 'object' || !('mode' in data)) throw new Error('Team authorization is unavailable.');
  const policyAdmin = 'policyAdmin' in data && typeof data.policyAdmin === 'boolean' ? { policyAdmin: data.policyAdmin } : {};
  if (data.mode === 'legacy') return { mode: 'legacy', ...policyAdmin };
  if (data.mode === 'restricted' && 'grants' in data && data.grants && typeof data.grants === 'object' && !Array.isArray(data.grants)) {
    return { mode: 'restricted', grants: Object.fromEntries(Object.entries(data.grants)), ...policyAdmin };
  }
  throw new Error('Team authorization is unavailable.');
}

export function staffPolicyRequestScope(access: RequestAccess | undefined): 'agency' | 'assigned' | null {
  if (access?.mode !== 'restricted') return null;
  const view = staffRecordScope(access, 'policies');
  const edit = access.grants['policies.edit'];
  return view && (edit === 'assigned' || edit === 'agency') ? view === 'assigned' || edit === 'assigned' ? 'assigned' : 'agency' : null;
}

export function permitsTeamRequest(access: RequestAccess, pathname: string, method: string, search = ''): boolean {
  if (access.mode === 'legacy') return true;
  if (!pathname.startsWith('/api/')) {
    if (canAccessTeamPage(access, pathname, search)) return true;
    return visibleStaffRecords(access).some((kind) => staffRecords[kind].href === pathname);
  }
  const policy = teamApiRoutePolicy(pathname, method);
  const read = method === 'GET' || method === 'HEAD';
  if (policy?.kind === 'permission') {
    const granted = policy.permissions.some((permission) => {
      const scope = access.grants[permission];
      if (scope !== 'agency' && scope !== 'assigned' && scope !== 'self') return false;
      if (!policy.recordScoped) return scope === 'agency';
      if (scope === 'agency') return true;
      return assignedRouteIsScoped(access, pathname, method, permission);
    });
    if (granted) return true;
  }
  if (pathname === '/api/agency') {
    const query = new URLSearchParams(search);
    if (query.get('team') === 'true' || query.get('access') === 'true') return access.grants['team.manage'] === 'agency';
    if (read || method === 'PUT') return access.grants['messages.send'] === 'agency' || access.grants['agency.manage'] === 'agency';
    if (method === 'POST') return access.grants['team.manage'] === 'agency';
    if (method === 'PATCH') return access.grants['leads.assign'] === 'agency' || access.grants['accounts.assign'] === 'agency';
    return false;
  }
  if (pathname === '/api/record-contact-preference') {
    const type = new URLSearchParams(search).get('type');
    if (read) return type === 'lead'
      ? staffRecordScope(access, 'leads') !== null
      : type === 'client' && accountRecordScope(access, 'accounts.view') !== null;
    return access.grants['leads.edit'] === 'agency' || access.grants['leads.edit'] === 'assigned'
      || access.grants['accounts.edit'] === 'agency' || access.grants['accounts.edit'] === 'assigned';
  }
  if (pathname === '/api/staff-policy-requests') {
    return read || method === 'PATCH' ? access.policyAdmin === true : method === 'POST' && !!staffPolicyRequestScope(access);
  }
  if (policy?.kind === 'permission') return false;
  if (policy?.kind !== 'handler') return false;
  if (read && policy.handler === 'records' && pathname === '/api/staff-records') {
    return !!(staffRecordScope(access, 'leads') || staffRecordScope(access, 'accounts') || staffRecordScope(access, 'policies'));
  }
  if (policy.handler === 'records') {
    if (pathname === '/api/reports' || pathname.startsWith('/api/reports/')) return access.grants['reports.view'] === 'agency';
    if (pathname === '/api/outreach/profile') {
      const type = new URLSearchParams(search).get('record_type');
      const permission = type === 'lead' ? (read ? 'leads.view' : 'leads.edit')
        : type === 'client' ? (read ? 'accounts.view' : 'accounts.edit') : null;
      return permission !== null && ['agency', 'assigned'].includes(String(access.grants[permission]));
    }
    if (pathname.startsWith('/api/intelligence/')) return access.grants['leads.prospect'] === 'agency';
    if (pathname.startsWith('/api/rashi/')) return access.grants['knowledge.view'] === 'agency';
    if (pathname === '/api/questionnaires/files' || pathname.startsWith('/api/questionnaires/files/')) {
      return access.grants['intake.manage'] === 'agency';
    }
    if (pathname === '/api/record-activity') {
      return access.grants['accounts.view'] === 'agency' || access.grants['leads.view'] === 'agency'
        || access.grants['messages.view'] === 'agency';
    }
    if (pathname === '/api/record-assets' || pathname === '/api/assets/list') {
      return read ? access.grants['documents.view'] === 'agency' || access.grants['accounts.view'] === 'agency'
        : access.grants['documents.edit'] === 'agency' || access.grants['accounts.edit'] === 'agency';
    }
    if (pathname === '/api/assets/create') return access.grants['documents.edit'] === 'agency';
    if (pathname === '/api/record-contact-preference') {
      return read ? access.grants['accounts.view'] === 'agency' : access.grants['accounts.edit'] === 'agency';
    }
    if (pathname === '/api/interactions') {
      return method === 'POST' ? access.grants['messages.send'] === 'agency'
        : access.grants['messages.view'] === 'agency';
    }
    if (pathname === '/api/vehicles' || pathname === '/api/workers-comp') {
      return read ? access.grants['policies.view'] === 'agency'
        : access.grants['policies.edit'] === 'agency' || access.grants['policies.delete'] === 'agency';
    }
    if (pathname.startsWith('/api/ai/')) {
      return access.grants['accounts.view'] === 'agency' || access.grants['leads.view'] === 'agency';
    }
    return false;
  }
  if (policy.handler === 'personal') {
    return pathname === '/api/account' || pathname === '/api/account/password' || pathname === '/api/account/email' || pathname === '/api/account/signature-image';
  }
  if (policy.handler === 'tasks') {
    const permission = read ? 'tasks.view' : 'tasks.edit';
    const scope = access.grants[permission];
    if (scope === 'agency') return true;
    return pathname === '/api/tasks' && ['assigned', 'self'].includes(String(scope));
  }
  if (policy.handler === 'calendar') {
    const permission = read ? 'calendar.view' : 'calendar.edit';
    if ((pathname === '/api/google-calendar/connect' || pathname === '/api/google-calendar/freebusy'
      || pathname === '/api/zoom/connect') && access.grants['integrations.manage'] === 'agency') return true;
    return access.grants[permission] === 'agency'
      || (access.grants[permission] === 'self' && (pathname === '/api/events'
        || /^\/api\/events\/[^/]+\/(confirmation|sync)$/.test(pathname)));
  }
  if (policy.handler === 'shell') return false;
  if (policy.handler === 'agency') {
    if (pathname === '/api/agency/assignment') {
      const type = new URLSearchParams(search).get('record_type');
      return type === 'lead' ? access.grants['leads.assign'] === 'agency'
        : type === 'client' && access.grants['accounts.assign'] === 'agency';
    }
    if (pathname === '/api/agency/sender' || pathname === '/api/agency/time-zone' || pathname === '/api/agency/outreach') {
      return access.grants['agency.manage'] === 'agency';
    }
    return false;
  }
  if (policy.handler === 'templates') {
    return read ? access.grants['content.view'] === 'agency'
      : pathname.endsWith('/sales-templates') && method === 'POST' ? access.grants['content.view'] === 'agency'
        : access.grants['content.edit'] === 'agency';
  }
  if (policy.handler === 'social') {
    if (read) return access.grants['social.view'] === 'agency';
    if (pathname.endsWith('/reviews')) return access.grants['social.approve'] === 'agency';
    if (pathname.endsWith('/connections') || pathname.includes('/connections/')) return access.grants['social.connections'] === 'agency';
    if (pathname.endsWith('/engine')) return access.grants['social.publish'] === 'agency' || access.grants['social.publish_direct'] === 'agency';
    if (pathname.endsWith('/drafts') || pathname.endsWith('/media') || pathname.endsWith('/captions')) return access.grants['social.edit'] === 'agency';
  }
  return false;
}

function assignedRouteIsScoped(access: RequestAccess, pathname: string, method: string, permission: string): boolean {
  return (pathname === '/api/staff-records' && method === 'GET')
    || (/^\/api\/clients\/[^/]+$/.test(pathname) && method === 'GET'
      && accountRecordScope(access, 'accounts.view') === 'assigned')
    || (pathname === '/api/clients' && method === 'PATCH'
      && accountRecordScope(access, 'accounts.edit') === 'assigned')
    || (/^\/api\/clients\/[^/]+\/files(?:\/[^/]+\/download|\/upload(?:\/complete)?)?$/.test(pathname)
      && (permission === 'documents.view' && method === 'GET'
        ? accountDocumentReadScope(access) === 'assigned'
        : permission === 'documents.edit' && ['POST', 'PATCH'].includes(method)
          ? accountRecordScope(access, 'documents.edit') === 'assigned'
          : permission === 'documents.delete' && method === 'DELETE'
            ? accountRecordScope(access, 'documents.delete') === 'assigned' : false));
}

export function teamLanding(access: RequestAccess): string {
  if (access.mode === 'legacy') return '/';
  const candidates = ['/', '/tasks', '/clients', '/leads', '/policies', '/communication', '/communication/social',
    '/outreach', '/scheduler', '/reports', '/rashi', '/learning', '/account'];
  return candidates.find((path) => canAccessTeamPage(access, path)) ?? '/account';
}
