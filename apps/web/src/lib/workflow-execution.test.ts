import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CrmWorkflowDefinition } from '@crm/shared';
import { enrollLead } from './outreach-engine';
import { requireMarketingConsent } from './marketing-email';
import { processWorkflowJobs, runWorkflowAutomation } from './workflow-execution';
import { WorkspaceError } from './record-scope';

vi.mock('./outreach-engine', () => ({ enrollLead: vi.fn() }));
vi.mock('./marketing-email', () => ({ requireMarketingConsent: vi.fn() }));
const id = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88a';
const rule = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88b';
const definition: CrmWorkflowDefinition = { schema_version: 1, name: 'Enroll future leads', event: 'lead.created', active: true,
  conditions: { sources: [], stages: [], statuses: [], lines: [], assignee: null },
  action: { type: 'enroll_sequence', content: '', delay_minutes: 0, priority: 'medium', assignee: null } };
let claim: unknown;
let counts: unknown;
let backlogRelease: unknown;
let failPath: string;
let writes: Array<Record<string, unknown>>;
let paths: string[];
const db = (): ReturnType<typeof createClient> => createClient('https://db.example.invalid', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const path = new URL(String(input)).pathname.split('/').pop() ?? '';
    paths.push(path);
    if (path === failPath) return new Response(JSON.stringify({ message: 'Persistence unavailable' }), { status: 500 });
    if (path === 'workflow_executions') writes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const result = path === 'release_workflow_backlog' ? backlogRelease
      : path === 'execute_workflow_internal' ? counts : path === 'claim_workflow_adapter_job' ? claim : path === 'workflow_executions' ? { id } : 0;
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
beforeEach(() => {
  vi.clearAllMocks(); failPath = ''; counts = { succeeded: 2, skipped: 1, failed: 0 };
  backlogRelease = { released: 2, skipped_stale: 1 }; writes = []; paths = [];
  claim = { id, rule_id: rule, owner_id: id, definition, context: { lead_id: id, email: ' PERSON@example.invalid ', assignee: null } };
  vi.mocked(requireMarketingConsent).mockResolvedValue(undefined);
  vi.mocked(enrollLead).mockResolvedValue({ drafted: false, enrollment: { id, lead_id: id, status: 'active', current_step: 0,
    total_steps: 3, step_gap_days: 5, next_send_at: null, last_sent_at: null, enrolled_at: '2026-11-05T00:00:00Z' } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
describe('guarded custom workflow sequence adapter', () => {
  it('does not invoke consent, enrollment or AI when no adapter job was claimed', async () => {
    claim = null;
    expect(await processWorkflowJobs(db())).toEqual({ succeeded: 2, skipped: 1, failed: 0 });
    expect(enrollLead).not.toHaveBeenCalled(); expect(requireMarketingConsent).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
  it('retains SQL-skipped jobs without attempting to enroll or overwrite their result', async () => {
    claim = { id, skipped: true };
    expect((await processWorkflowJobs(db())).skipped).toBe(2);
    expect(enrollLead).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
  it.each(['enroll_sequence', 'draft_sequence'] as const)('runs %s through the existing consented adapter with a total draft deadline', async (type) => {
    claim = { id, rule_id: rule, owner_id: id, definition: { ...definition, action: { ...definition.action, type } },
      context: { lead_id: id, email: ' PERSON@example.invalid ', assignee: null } };
    expect((await processWorkflowJobs(db())).succeeded).toBe(3);
    expect(requireMarketingConsent).toHaveBeenCalledWith(expect.anything(), 'person@example.invalid');
    expect(enrollLead).toHaveBeenCalledWith(expect.anything(), id, id,
      expect.objectContaining({ jobId: id, ruleId: rule, draft: type === 'draft_sequence', deadline: expect.any(Number) }));
    expect(writes[0]).toMatchObject({ status: 'succeeded', result: { enrollment_id: id, drafted: false, manual_approval_required: true } });
  });
  it('records a business refusal as skipped and never calls enrollment after consent refusal', async () => {
    vi.mocked(requireMarketingConsent).mockRejectedValue(new WorkspaceError('Marketing permission required', 403));
    expect((await processWorkflowJobs(db())).skipped).toBe(2);
    expect(enrollLead).not.toHaveBeenCalled(); expect(writes[0]).toMatchObject({ status: 'skipped', error: 'Marketing permission required' });
  });
  it('records unexpected adapter failures explicitly and makes the tracked job partial', async () => {
    vi.mocked(enrollLead).mockRejectedValue(new Error('Draft persistence failed'));
    expect(await runWorkflowAutomation(db())).toMatchObject({ status: 'partial', summary: { failed: 1 }, error: expect.stringContaining('Review') });
    expect(writes[0]).toMatchObject({ status: 'failed', error: 'Draft persistence failed' });
  });
  it('releases only an owner-confirmed backlog before the explicit manual workflow run', async () => {
    const result = await runWorkflowAutomation(db(), id);
    expect(result.summary).toMatchObject({ backlog_released: 2, backlog_skipped_stale: 1 });
    expect(paths[0]).toBe('release_workflow_backlog');
    expect(paths).toContain('execute_workflow_internal');
  });
  it('keeps scheduled workflow processing from releasing held backlog work', async () => {
    await runWorkflowAutomation(db());
    expect(paths).not.toContain('release_workflow_backlog');
  });
  it('does not invent successful enrollment when the adapter returns none', async () => {
    vi.mocked(enrollLead).mockResolvedValue({ drafted: false, message: 'This lead is archived' });
    expect((await processWorkflowJobs(db())).skipped).toBe(2);
    expect(writes[0]).toMatchObject({ status: 'skipped', error: 'This lead is archived' });
  });
  it.each(['emit_workflow_due_events', 'execute_workflow_internal', 'claim_workflow_adapter_job', 'workflow_executions'])('surfaces %s persistence errors without blind retries', async (path) => {
    failPath = path;
    await expect(processWorkflowJobs(db())).rejects.toThrow();
    expect(paths.filter((value) => value === path)).toHaveLength(1);
  });
  it.each([{}, { succeeded: -1, skipped: 0, failed: 0 }, { succeeded: 0.5, skipped: 0, failed: 0 }])('rejects malformed internal counters %#', async (value) => {
    counts = value;
    await expect(processWorkflowJobs(db())).rejects.toThrow('counters');
    expect(enrollLead).not.toHaveBeenCalled();
  });
  it('fails invalid claimed jobs before any consent or enrollment work', async () => {
    claim = { id: 'invented' };
    await expect(processWorkflowJobs(db())).rejects.toThrow('Investigate');
    expect(enrollLead).not.toHaveBeenCalled(); expect(requireMarketingConsent).not.toHaveBeenCalled();
  });
});
