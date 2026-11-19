import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordTarget } from '@crm/shared';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { opportunityContext, opportunityDatabaseError, opportunityWorkspace } from './opportunity-server';
import { discoveryFilters } from './discovery';

export async function runOpportunityJobs(db: SupabaseClient): Promise<{ succeeded: number; failed: number; digests: number }> {
  const claimed = await db.rpc('claim_opportunity_jobs', { p_limit: 4 });
  if (claimed.error) opportunityDatabaseError(claimed.error);
  if (!Array.isArray(claimed.data)) throw new WorkspaceError('OIP job claims could not be verified.', 503);
  let succeeded = 0, failed = 0;
  for (const raw of claimed.data) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.lease_token !== 'string'
      || typeof raw.actor_id !== 'string' || typeof raw.target_id !== 'string') throw new WorkspaceError('OIP returned an invalid lease.', 503);
    try {
      let snapshot: object;
      if (raw.target_type === 'search') {
        const search = await db.from('discovery_saved_searches').select('name,filters').eq('id', raw.target_id).eq('user_id', raw.actor_id).single();
        if (search.error) opportunityDatabaseError(search.error);
        const candidates = await db.rpc('search_discovery_candidates', { p_actor: raw.actor_id, p_filters: discoveryFilters(search.data.filters), p_page: 0 });
        if (candidates.error) opportunityDatabaseError(candidates.error);
        if (!isRecord(candidates.data) || typeof candidates.data.total !== 'number') throw new WorkspaceError('Saved-search results could not be verified.', 503);
        snapshot = { record_name: search.data.name, total: candidates.data.total, evaluated_on: new Date().toISOString().slice(0, 10),
          mode: 'retained_candidates_only', filters: search.data.filters };
      } else {
        if (raw.target_type !== 'lead' && raw.target_type !== 'client') throw new WorkspaceError('Unsupported watch target.', 400);
        const target: RecordTarget = { type: raw.target_type, id: raw.target_id };
        const context = await opportunityContext(db, raw.actor_id, target);
        if (context.dossier.scope_key !== raw.scope_key) throw new WorkspaceError('Account linkage changed. Reopen this business and re-enable its watch.', 409);
        snapshot = opportunityWorkspace(context, target);
      }
      const saved = await db.rpc('finish_opportunity_job', { p_watch: raw.id, p_lease: raw.lease_token, p_snapshot: snapshot, p_error: null });
      if (saved.error) opportunityDatabaseError(saved.error);
      succeeded++;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'OIP evaluation failed.';
      console.error('[opportunity/job]', message);
      const recorded = await db.rpc('finish_opportunity_job', { p_watch: raw.id, p_lease: raw.lease_token, p_snapshot: null, p_error: message });
      if (recorded.error) opportunityDatabaseError(recorded.error);
      failed++;
    }
  }
  const digest = await db.rpc('build_opportunity_digests');
  if (digest.error) opportunityDatabaseError(digest.error);
  return { succeeded, failed, digests: Number(digest.data) };
}
