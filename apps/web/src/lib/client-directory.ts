import { accountLifecycle, type AccountLifecycle, type PolicyLifecycleRow } from './account-lifecycle';
import { arizonaDateTimeInput } from './arizona-time';

export interface DirectoryAccount {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  assigned_producer: string | null;
  account_type: string | null;
  source?: string | null;
  email_consent?: boolean | null;
  sms_consent?: boolean | null;
  preferred_channel?: string | null;
  created_at: string;
}
export interface DirectoryPolicy extends PolicyLifecycleRow {
  id: string;
  account_id: string | null;
  policy_number: string | null;
}
export interface DirectoryTask {
  id: string;
  account_id: string | null;
  related_type: string | null;
  related_id: string | null;
  subject: string;
  due_date: string | null;
}
export interface DirectoryRow extends DirectoryAccount {
  business_names: string[];
  lifecycle: AccountLifecycle;
  policy_count: number;
  overdue_count: number;
  renewal_date: string | null;
  next_task: DirectoryTask | null;
}
export interface DirectoryResult {
  items: DirectoryRow[];
  total: number;
  page: number;
  page_size: number;
}
export const directoryFilters = ['all', 'active', 'prospect', 'former', 'renewals', 'overdue'] as const;
export type DirectoryFilter = typeof directoryFilters[number];

export function directoryRows(accounts: DirectoryAccount[], policies: DirectoryPolicy[], tasks: DirectoryTask[],
  businesses: Map<string, string[]>, search: string, filter: DirectoryFilter, now = new Date()): DirectoryRow[] {
  const today = arizonaDateTimeInput(now).slice(0, 10);
  const thirtyDays = arizonaDateTimeInput(new Date(now.getTime() + 30 * 86400000)).slice(0, 10);
  const needle = search.trim().toLowerCase();
  return accounts.flatMap((account) => {
    const accountPolicies = policies.filter((policy) => (policy.client_id ?? policy.account_id) === account.id);
    const work = tasks.filter((task) => (task.account_id ?? (task.related_type === 'client' ? task.related_id : null)) === account.id)
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.id.localeCompare(b.id));
    const businessNames = businesses.get(account.id) ?? [];
    const phoneMatch = /\d/.test(search) && /^\+?[\d\s()-]+$/.test(search)
      && account.phone?.replace(/\D/g, '').includes(search.replace(/\D/g, ''));
    if (needle && !phoneMatch && ![account.full_name, account.email, account.phone, ...businessNames, ...accountPolicies.map((policy) => policy.policy_number)]
      .some((value) => value?.toLowerCase().includes(needle))) return [];
    const lifecycle = accountLifecycle(accountPolicies, now);
    const overdue = work.filter((task) => task.due_date && Date.parse(task.due_date) < now.getTime()).length;
    const renewals = accountPolicies.filter((policy) => ['active', 'issued', 'bound', 'in_force', 'inforce'].includes((policy.status ?? '').toLowerCase()))
      .map((policy) => policy.expiration_date ?? policy.renewal_date).filter((date): date is string => Boolean(date && date >= today))
      .sort();
    const renewal = renewals[0] ?? null;
    if (filter === 'active' && lifecycle !== 'Active client'
      || filter === 'prospect' && lifecycle !== 'Prospect'
      || filter === 'former' && lifecycle !== 'Former client'
      || filter === 'overdue' && !overdue
      || filter === 'renewals' && (!renewal || renewal > thirtyDays)) return [];
    return [{ ...account, business_names: businessNames, lifecycle, policy_count: accountPolicies.length,
      overdue_count: overdue, renewal_date: renewal, next_task: work[0] ?? null }];
  }).sort((a, b) => b.overdue_count - a.overdue_count || a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id));
}
