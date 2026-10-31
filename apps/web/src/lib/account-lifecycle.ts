import type { SupabaseClient } from '@supabase/supabase-js';
import { arizonaDateTimeInput } from './arizona-time';
import { databaseError } from './workspace-api';

export interface PolicyLifecycleRow {
  client_id?: string | null;
  status?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
}

export type AccountLifecycle = 'Prospect' | 'Active client' | 'Client - policy scheduled' | 'Former client' | 'Client - verify policy status';
const PLACED_STATUSES = new Set(['active', 'issued', 'bound', 'in_force', 'inforce', 'expired', 'cancelled', 'canceled', 'lapsed']);
const IN_FORCE_STATUSES = new Set(['active', 'issued', 'bound', 'in_force', 'inforce']);

export function accountLifecycle(policies: PolicyLifecycleRow[], now = new Date()): AccountLifecycle {
  const today = arizonaDateTimeInput(now).slice(0, 10);
  const placed = policies.filter((policy) => PLACED_STATUSES.has((policy.status ?? '').toLowerCase()));
  if (!placed.length) return 'Prospect';
  const open = placed.filter((policy) => IN_FORCE_STATUSES.has((policy.status ?? '').toLowerCase()));
  if (open.some((policy) => policy.effective_date && policy.effective_date <= today
    && (policy.expiration_date ?? policy.renewal_date ?? '') >= today)) return 'Active client';
  if (open.some((policy) => policy.effective_date && policy.effective_date > today)) return 'Client - policy scheduled';
  if (open.some((policy) => !policy.effective_date || !(policy.expiration_date ?? policy.renewal_date))) return 'Client - verify policy status';
  return 'Former client';
}

export async function loadAccountLifecycles(supabase: SupabaseClient, ids: string[]): Promise<Map<string, AccountLifecycle>> {
  const result = new Map<string, AccountLifecycle>();
  if (!ids.length) return result;
  const rows: PolicyLifecycleRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('policies')
      .select('client_id,status,effective_date,expiration_date,renewal_date').in('client_id', ids)
      .order('id').range(offset, offset + 999);
    if (error) throw databaseError(error);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  for (const id of ids) result.set(id, accountLifecycle(rows.filter((row) => row.client_id === id)));
  return result;
}
