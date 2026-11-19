import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { BUILT_IN_AUTOMATION_DEFAULTS, DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { POST } from '../app/api/import/[batchId]/commit/route';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: '168413e9-a6a4-4dff-a8bf-8f8df83dace9' }, error: null }) }));
const batch = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const row = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let notifications: unknown[];
let calls: Array<Record<string, unknown>>;
let disposition: string;
let rpcFailure: boolean;
let corruptRaw: boolean;
let invalidResult: boolean;
let automation = structuredClone(BUILT_IN_AUTOMATION_DEFAULTS);

beforeEach(() => {
  vi.clearAllMocks(); notifications = []; calls = []; disposition = 'committed'; rpcFailure = false;
  corruptRaw = false; invalidResult = false; automation = structuredClone(BUILT_IN_AUTOMATION_DEFAULTS);
  const db = createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/notifications')) { notifications.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }); }
      if (url.pathname.endsWith('/import_batches')) return json({ id: batch, file_name: 'test.csv' });
      if (url.pathname.endsWith('/outreach_settings')) return json({ configuration_revision: 4, automation_configuration: automation,
        approval_mode: true, daily_send_cap: 20, send_window_start: 8, send_window_end: 17,
        opt_out_footer: 'Test footer', sender_profile: DEFAULT_OUTREACH_SENDER });
      if (url.pathname.endsWith('/import_prospects')) return json([{
        id: row, full_name: 'Synthetic prospect', email: 'test@example.invalid', phone: null, address: null, line_of_business: 'Commercial',
        disposition: corruptRaw ? 'committed' : 'pending', payload: { ...(corruptRaw ? { raw: [null] } : {}),
          profile: { kind: 'commercial', renewals: [{ type: 'General Liability', date: '2027-04-22' }] } },
      }]);
      if (url.pathname.endsWith('/promote_import_prospect')) {
        calls.push(JSON.parse(String(init?.body)));
        if (rpcFailure) return json({ message: 'This prospect changed during review. Refresh before importing.', code: 'PT409' }, 409);
        return json({ disposition, lead_id: row, tasks_created: invalidResult ? -1 : disposition === 'committed' ? 1 : 0, contact_tasks_created: disposition === 'committed' ? 1 : 0 });
      }
      throw new Error('Unexpected request: ' + url.pathname);
    } },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
const commit = (body: unknown = {}) => POST(new NextRequest(`http://localhost/api/import/${batch}/commit`, {
  method: 'POST', body: JSON.stringify(body),
}), { params: Promise.resolve({ batchId: batch }) });

describe('transactional import reporting', () => {
  it('passes identity snapshot, authenticated actor and classified evidence in one RPC', async () => {
    const result = await commit();
    expect(await result.json()).toMatchObject({ committed: 1, contact_tasks_created: 1, tasks_created: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      p_actor: '168413e9-a6a4-4dff-a8bf-8f8df83dace9', p_prospect: row,
      p_profile: { renewals: [expect.objectContaining({ evidence_class: 'predicted', precision: 'month' })] },
      p_expected: { full_name: 'Synthetic prospect', email: 'test@example.invalid' },
    });
    expect(notifications).toHaveLength(1);
  });
  it('uses the saved import renewal gate and timing when building transactional tasks', async () => {
    automation = { ...automation, import_renewal: { tasks_enabled: false, task_days_before: 14 } };
    const result = await commit();
    expect(result.status).toBe(200);
    expect(calls[0].p_tasks).toEqual([]);
  });
  it('retries report existing promotion without a duplicate summary', async () => {
    disposition = 'already_committed';
    expect(await (await commit({ include_ids: [row] })).json()).toMatchObject({ committed: 0, already_committed: 1, tasks_created: 0 });
    expect(notifications).toEqual([]);
  });
  it('reconciles an already-imported retry even when old raw rows are no longer parseable', async () => {
    disposition = 'already_committed'; corruptRaw = true;
    expect(await (await commit({ include_ids: [row] })).json()).toMatchObject({ committed: 0, already_committed: 1, failed: 0 });
  });
  it('rejects invalid success counters instead of reporting a verified import', async () => {
    invalidResult = true;
    expect(await (await commit()).json()).toMatchObject({ committed: 0, failed: 1 });
  });
  it('returns failed per-item state rather than a saved lead with missing task success', async () => {
    rpcFailure = true;
    expect(await (await commit()).json()).toMatchObject({ committed: 0, failed: 1, results: [expect.objectContaining({ disposition: 'failed' })] });
    expect(notifications).toEqual([]);
  });
  it('marks matches as duplicate review without importing', async () => {
    disposition = 'duplicate';
    expect(await (await commit()).json()).toMatchObject({ committed: 0, duplicates: 1 });
  });
  it('rejects unknown selected IDs before promotion', async () => {
    expect((await commit({ include_ids: [batch] })).status).toBe(409);
    expect(calls).toEqual([]);
  });
});
