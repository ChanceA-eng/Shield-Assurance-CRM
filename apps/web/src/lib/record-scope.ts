import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordTarget } from '@crm/shared';
import { isUuid } from './workspace-validation';

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface RecordScope {
  target: RecordTarget;
  leadId: string | null;
  clientId: string | null;
  name: string;
}

export async function resolveRecordScope(supabase: SupabaseClient, target: RecordTarget): Promise<RecordScope> {
  if (!isUuid(target.id)) throw new WorkspaceError('A valid record id is required.', 400);
  const { data, error } = await supabase
    .from(target.type === 'lead' ? 'leads' : 'clients')
    .select(target.type === 'lead' ? 'id,full_name,account_id' : 'id,full_name')
    .eq('id', target.id)
    .maybeSingle<{ id: string; full_name: string; account_id?: string | null }>();
  if (error) throw new WorkspaceError(error.message, 500);
  if (!data) throw new WorkspaceError(`${target.type === 'lead' ? 'Lead' : 'Client'} not found.`, 404);
  return {
    target,
    leadId: target.type === 'lead' ? data.id : null,
    clientId: target.type === 'client' ? data.id : data.account_id ?? null,
    name: data.full_name,
  };
}

export function recordFilter(scope: RecordScope): string {
  const parts: string[] = [];
  if (scope.leadId) parts.push(`lead_id.eq.${scope.leadId}`);
  if (scope.clientId) parts.push(`client_id.eq.${scope.clientId}`);
  return parts.join(',');
}

export function taskFilter(scope: RecordScope): string {
  const parts = [`and(related_type.eq.${scope.target.type},related_id.eq.${scope.target.id})`];
  if (scope.clientId) {
    parts.push(`account_id.eq.${scope.clientId}`, `and(related_type.eq.client,related_id.eq.${scope.clientId})`);
  }
  return parts.join(',');
}

export function namedTaskSubject(name: string, action: string): string {
  const trimmed = action.trim();
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i').test(trimmed) ? trimmed : `${name}: ${trimmed}`;
}
