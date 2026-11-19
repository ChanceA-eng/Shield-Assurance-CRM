import { beforeEach, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE } from '@crm/shared';
import { runOpportunityJobs } from './opportunity-jobs';
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c', actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const day = new Date().toISOString().slice(0, 10);
let mode: 'business' | 'search' | 'denied' | 'changed' | 'paused' = 'business';
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
beforeEach(() => { calls.length = 0; mode = 'business'; });
function database() {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), name = url.pathname.split('/').pop() ?? '';
    const args = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ name, args });
    if (name === 'claim_opportunity_jobs') return Response.json(mode === 'paused' ? [] : [{ id, actor_id: actor, target_id: id,
      target_type: mode === 'search' ? 'search' : 'lead', scope_key: `lead:${id}`, lease_token: actor }]);
    if (name === 'get_opportunity_context') {
      if (mode === 'denied') return Response.json({ code: '42501', message: 'Access revoked' }, { status: 403 });
      return Response.json({ dossier: { scope_key: `lead:${id}`, record_name: 'Synthetic', version: 0, findings: EMPTY_DOSSIER_FINDINGS,
        observations: [], confirmations: [], observations_total: 0, history_total: 0, page: 0 },
      profile: { scope_key: `lead:${id}`, revision: 1, profile: { ...EMPTY_OPPORTUNITY_PROFILE, source_reference: 'Synthetic', confirmed_on: day } },
      carriers: [], evidence_token: 'current', evaluated_on: day, recipient: null });
    }
    if (name === 'finish_opportunity_job') return mode === 'changed' && args.p_snapshot
      ? Response.json({ code: 'PT409', message: 'Evidence changed during evaluation' }, { status: 409 }) : Response.json(true);
    if (name === 'discovery_saved_searches') return Response.json({ name: 'Synthetic saved search', filters: {} });
    if (name === 'search_discovery_candidates') return Response.json({ candidates: [], total: 3 });
    if (name === 'build_opportunity_digests') return Response.json(0);
    throw new Error(`Unexpected external call: ${name}`);
  };
  return createClient('https://example.supabase.co', 'synthetic', { global: { fetch: fetcher }, auth: { persistSession: false } });
}
it('re-evaluates retained business evidence and completes its fenced lease without contacting providers', async () => {
  expect(await runOpportunityJobs(database())).toEqual({ succeeded: 1, failed: 0, digests: 0 });
  expect(calls.map((item) => item.name)).toEqual(['claim_opportunity_jobs', 'get_opportunity_context', 'finish_opportunity_job', 'build_opportunity_digests']);
  expect(calls[2].args).toMatchObject({ p_watch: id, p_lease: actor, p_error: null, p_snapshot: { evidence_token: 'current' } });
});
it.each(['denied', 'changed'] as const)('records %s evidence/permission failures visibly instead of success-shaped results', async (value) => {
  mode = value;
  expect(await runOpportunityJobs(database())).toEqual({ succeeded: 0, failed: 1, digests: 0 });
  expect(calls.find((item) => item.name === 'finish_opportunity_job' && item.args.p_error)?.args.p_error).toBeTruthy();
});
it('refreshes only retained saved-search results, not acquisitions or paid providers', async () => {
  mode = 'search';
  expect((await runOpportunityJobs(database())).succeeded).toBe(1);
  expect(calls.map((item) => item.name)).toEqual(['claim_opportunity_jobs', 'discovery_saved_searches', 'search_discovery_candidates', 'finish_opportunity_job', 'build_opportunity_digests']);
  expect(calls[3].args.p_snapshot).toMatchObject({ total: 3, mode: 'retained_candidates_only' });
});
it('does no record evaluation when claims are paused', async () => {
  mode = 'paused';
  expect(await runOpportunityJobs(database())).toEqual({ succeeded: 0, failed: 0, digests: 0 });
  expect(calls.map((item) => item.name)).toEqual(['claim_opportunity_jobs', 'build_opportunity_digests']);
});
