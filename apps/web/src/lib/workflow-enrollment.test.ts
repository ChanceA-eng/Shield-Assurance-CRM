import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { enrollLead, type EnrollmentRow } from './outreach-engine';
import { draftSequenceStep } from './outreach-ai';

vi.mock('./outreach-ai', () => ({ draftSequenceStep: vi.fn() }));
vi.mock('./lead-outreach-context', () => ({ leadOutreachContext: vi.fn().mockResolvedValue({}) }));
vi.mock('./agency-membership', () => ({ agencyEnabled: vi.fn().mockReturnValue(false) }));
const id = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88a';
const ruleId = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88b';
const jobId = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88c';
const enrollment: EnrollmentRow = { id, lead_id: id, status: 'active', current_step: 0, total_steps: 3, step_gap_days: 5,
  next_send_at: '2026-11-06T00:00:00Z', last_sent_at: null, enrolled_at: '2026-11-05T00:00:00Z' };
let existing: EnrollmentRow | null;
let result: unknown;
let rpcFailure: boolean;
let calls: Array<{ path: string; method: string; body: unknown }>;
const db = (): ReturnType<typeof createClient> => createClient('https://db.example.invalid', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const path = new URL(String(input)).pathname.split('/').pop() ?? '';
    const method = init?.method ?? 'GET';
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '0-0/0' } });
    if (path === 'enroll_workflow_sequence' && rpcFailure) return new Response(JSON.stringify({ code: 'PT409', message: 'Existing sequence preserved' }), { status: 409 });
    const data = path === 'leads' ? { id, full_name: 'Workflow lead', email: 'qa@example.invalid', status: 'new' }
      : path === 'outreach_opt_outs' ? null : path === 'sequence_enrollments' ? method === 'POST' ? enrollment : existing
      : path === 'enroll_workflow_sequence' ? result : path === 'create_outreach_draft' ? true : [];
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } },
});
beforeEach(() => {
  vi.clearAllMocks(); existing = null; rpcFailure = false; calls = [];
  result = { ...enrollment, workflow_rule_id: ruleId, workflow_execution_id: jobId };
  vi.mocked(draftSequenceStep).mockResolvedValue({ subject: 'QA draft', body: 'No provider delivery in unit tests.', cited_signals: [] });
});
afterEach(() => vi.restoreAllMocks());
describe('workflow enrollment through the existing outreach engine', () => {
  it('enrolls without invoking AI or touching outbox for an enroll-only action', async () => {
    expect(await enrollLead(db(), id, id, { jobId, ruleId, draft: false })).toMatchObject({ drafted: false, enrollment: { id, workflow_rule_id: ruleId } });
    expect(draftSequenceStep).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path === 'outreach_outbox' || call.path === 'create_outreach_draft')).toBe(false);
    expect(calls.find((call) => call.path === 'enroll_workflow_sequence')?.body).toEqual({
      p_job: jobId, p_agent: id, p_mailbox: null, p_sender: null, p_recipient: 'qa@example.invalid',
    });
    expect(calls.some((call) => call.path === 'sequence_enrollments' && call.method !== 'GET')).toBe(false);
  });
  it('drafts only after confirmed provenance and passes the same total AI deadline', async () => {
    const deadline = Date.now() + 20000;
    expect((await enrollLead(db(), id, id, { jobId, ruleId, draft: true, deadline })).drafted).toBe(true);
    expect(draftSequenceStep).toHaveBeenCalledWith(expect.objectContaining({ id }), 1, 3, [], deadline);
    expect(calls.filter((call) => call.path === 'create_outreach_draft')).toHaveLength(1);
  });
  it('preserves another existing sequence and does not draft when the locked RPC refuses enrollment', async () => {
    existing = enrollment; rpcFailure = true;
    await expect(enrollLead(db(), id, id, { jobId, ruleId, draft: true })).rejects.toThrow('Existing sequence preserved');
    expect(draftSequenceStep).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path === 'sequence_enrollments' && call.method !== 'GET')).toBe(false);
  });
  it.each([null, { ...enrollment }, { ...enrollment, workflow_rule_id: ruleId, workflow_execution_id: ruleId }])('rejects an unverified workflow enrollment %# before invoking AI', async (value) => {
    result = value;
    await expect(enrollLead(db(), id, id, { jobId, ruleId, draft: true })).rejects.toThrow('verified');
    expect(draftSequenceStep).not.toHaveBeenCalled();
  });
  it('preserves the ordinary manual missing-draft retry behavior', async () => {
    existing = enrollment;
    expect(await enrollLead(db(), id)).toMatchObject({ enrollment, drafted: true });
    expect(draftSequenceStep).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.path === 'enroll_workflow_sequence' || (call.path === 'sequence_enrollments' && call.method !== 'GET'))).toBe(false);
  });
  it('does not resume or draft an ordinary paused sequence', async () => {
    existing = { ...enrollment, status: 'paused' };
    expect(await enrollLead(db(), id)).toMatchObject({ drafted: false, message: 'Already enrolled (paused).' });
    expect(draftSequenceStep).not.toHaveBeenCalled();
  });
  it('surfaces unavailable AI instead of claiming a draft was saved', async () => {
    vi.mocked(draftSequenceStep).mockResolvedValue(null);
    await expect(enrollLead(db(), id, id, { jobId, ruleId, draft: true })).rejects.toThrow('No outreach draft was saved');
    expect(calls.some((call) => call.path === 'create_outreach_draft')).toBe(false);
  });
});
