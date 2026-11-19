import type { RequestAccess } from './team-request-access';

export const STAFF_RECORDS_HEADER = 'x-crm-staff-records';
export const staffRecords = {
  leads: { href: '/leads', label: 'Leads' },
  accounts: { href: '/clients', label: 'Accounts' },
  policies: { href: '/policies', label: 'Policies' },
} as const;
export type StaffRecordKind = keyof typeof staffRecords;
const kinds: StaffRecordKind[] = ['leads', 'accounts', 'policies'];

export function isStaffRecordKind(value: string | null): value is StaffRecordKind {
  return kinds.some((kind) => kind === value);
}

export function staffRecordScope(access: RequestAccess | undefined, kind: StaffRecordKind): 'agency' | 'assigned' | null {
  if (access?.mode === 'legacy') return 'agency';
  if (access?.mode !== 'restricted') return null;
  const grant = access.grants[kind === 'leads' ? 'leads.view' : kind === 'accounts' ? 'accounts.view' : 'policies.view'];
  if (grant !== 'agency' && grant !== 'assigned') return null;
  if (kind !== 'policies') return grant;
  const parent = access.grants['accounts.view'];
  if (parent !== 'agency' && parent !== 'assigned') return null;
  return parent === 'assigned' || grant === 'assigned' ? 'assigned' : 'agency';
}

export function visibleStaffRecords(access: RequestAccess): StaffRecordKind[] {
  return kinds.filter((kind) => staffRecordScope(access, kind) !== null);
}

export function readStaffRecords(value: string | null): StaffRecordKind[] {
  return kinds.filter((kind) => value?.split(',').includes(kind));
}
