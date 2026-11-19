import type { SupabaseClient } from '@supabase/supabase-js';
import { teamApiRoutePolicy } from './team-route-policy';
import { staffRecords, staffRecordScope, visibleStaffRecords } from './staff-records';

type Grants = Readonly<Record<string, unknown>>;
export type RequestAccess = ({ mode: 'legacy' } | { mode: 'restricted'; grants: Grants }) & {
  policyAdmin?: boolean;
  verifiedOwnerFallback?: true;
};

export function accountRecordScope(
  access: RequestAccess | undefined,
  action: 'accounts.view' | 'accounts.edit' | 'documents.view' | 'documents.edit',
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

export function permitsTeamRequest(access: RequestAccess, pathname: string, method: string): boolean {
  if (access.mode === 'legacy') return true;
  if (!pathname.startsWith('/api/')) {
    return pathname === '/account' || (pathname === '/communication/social' && access.grants['social.view'] === 'agency')
      || visibleStaffRecords(access).some((kind) => staffRecords[kind].href === pathname);
  }
  const policy = teamApiRoutePolicy(pathname, method);
  const read = method === 'GET' || method === 'HEAD';
  if (pathname === '/api/staff-policy-requests') {
    return read || method === 'PATCH' ? access.policyAdmin === true : method === 'POST' && !!staffPolicyRequestScope(access);
  }
  if (policy?.kind === 'permission') {
    if (method === 'POST' && /^\/api\/clients\/[^/]+\/files\/upload(?:\/complete)?\/?$/.test(pathname)
      && policy.permissions.includes('documents.edit')) {
      return accountRecordScope(access, 'documents.edit') !== null && accountDocumentReadScope(access) !== null;
    }

    if (method === 'PATCH' && /^\/api\/clients\/?$/.test(pathname) && policy.permissions.includes('accounts.edit')) {
      return accountRecordScope(access, 'accounts.edit') !== null;
    }
    if (read && /^\/api\/clients\/[0-9a-f-]{36}\/?$/i.test(pathname) && policy.permissions.includes('accounts.view')) {
      return accountRecordScope(access, 'accounts.view') !== null;
    }
  }
  if (read && policy?.kind === 'permission' && policy.permissions.includes('documents.view')
    && /^\/api\/clients\/[^/]+\/files(?:\/[^/]+\/download)?\/?$/.test(pathname)) {
    return accountDocumentReadScope(access) !== null;
  }
  if (policy?.kind !== 'handler') return false;
  if (read && policy.handler === 'records' && pathname === '/api/staff-records') {
    return !!(staffRecordScope(access, 'leads') || staffRecordScope(access, 'accounts') || staffRecordScope(access, 'policies'));
  }
  if (policy.handler === 'personal') {
    return pathname === '/api/account' || pathname === '/api/account/password' || pathname === '/api/account/email' || pathname === '/api/account/signature-image';
  }
  if (policy.handler !== 'social') return false;
  if (read) return ['/api/social-marketing/drafts', '/api/social-marketing/media', '/api/social-marketing/captions'].includes(pathname)
    && access.grants['social.view'] === 'agency';
  return method === 'POST' && ['/api/social-marketing/drafts', '/api/social-marketing/media', '/api/social-marketing/captions'].includes(pathname)
    && access.grants['social.view'] === 'agency' && access.grants['social.edit'] === 'agency';
}

export function teamLanding(access: RequestAccess): '/' | '/account' | '/communication/social' | '/leads' | '/clients' | '/policies' {
  if (access.mode === 'legacy') return '/';
  const [first] = visibleStaffRecords(access);
  if (first) return staffRecords[first].href;
  return access.grants['social.view'] === 'agency' ? '/communication/social' : '/account';
}
