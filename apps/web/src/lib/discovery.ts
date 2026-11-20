import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_DISCOVERY_FILTERS, validEvidenceDate, type DiscoveryFilters } from '@crm/shared';
import { isRecord, isUuid } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { requireTeamPermission, type RequestAccess } from './team-request-access';

export function discoveryAccess(access: RequestAccess | undefined): void {
  requireTeamPermission(access, 'leads.prospect');
}

export function discoveryFilters(value: unknown): DiscoveryFilters {
  if (!isRecord(value)) throw new WorkspaceError('Provide targeting filters.', 400);
  const result = { ...EMPTY_DISCOVERY_FILTERS };
  for (const field of ['query', 'industry', 'state', 'line', 'renewal_from', 'renewal_to', 'source_id'] as const) {
    const text = value[field] ?? '';
    if (typeof text !== 'string' || text.length > 120) throw new WorkspaceError('Targeting fields must be text of up to 120 characters.', 400);
    result[field] = text.trim();
  }
  result.state = result.state.toUpperCase();
  if (result.state && !/^[A-Z]{2}$/.test(result.state)) throw new WorkspaceError('Use a two-letter state code.', 400);
  if (result.source_id && !isUuid(result.source_id)) throw new WorkspaceError('Choose a valid source.', 400);
  for (const field of ['employees_min', 'employees_max'] as const) {
    const number = value[field] ?? null;
    if (number !== null && (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 10000000)) {
      throw new WorkspaceError('Employee limits must be whole numbers between zero and 10000000.', 400);
    }
    result[field] = number;
  }
  if (result.employees_min !== null && result.employees_max !== null && result.employees_min > result.employees_max) {
    throw new WorkspaceError('Minimum employees must not exceed maximum employees.', 400);
  }
  for (const field of ['renewal_from', 'renewal_to'] as const) {
    if (result[field] && (!/^\d{4}-\d{2}$/.test(result[field]) || !validEvidenceDate(`${result[field]}-01`))) {
      throw new WorkspaceError('Use valid renewal months.', 400);
    }
  }
  if (result.renewal_from && result.renewal_to && result.renewal_from > result.renewal_to) throw new WorkspaceError('Renewal end month must follow its start month.', 400);
  const review = value.review ?? 'all';
  if (!['all', 'promoted', 'discovered', 'needs_verification', 'reviewed', 'dismissed'].includes(String(review))) {
    throw new WorkspaceError('Choose a valid review state.', 400);
  }
  result.review = review as DiscoveryFilters['review'];
  return result;
}

export async function approvedDiscoverySource(db: SupabaseClient, sourceId: string, provider: 'file' | 'fmcsa' = 'file'): Promise<void> {
  const result = await db.from('discovery_sources').select('*').eq('id', sourceId).maybeSingle();
  if (result.error) throw databaseError(result.error);
  if (!result.data?.active || result.data.acquisition_until < new Date().toISOString().slice(0, 10)) {
    throw new WorkspaceError('Choose an active owner-approved source before acquisition.', 403);
  }
  if ((result.data.provider ?? 'file') !== provider) throw new WorkspaceError('This approval is for a different source type. Choose the correct source.', 403);
}
