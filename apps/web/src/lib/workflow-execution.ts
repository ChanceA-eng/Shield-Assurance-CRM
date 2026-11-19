import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkflowDefinition } from '@crm/shared';
import { enrollLead } from './outreach-engine';
import { requireMarketingConsent } from './marketing-email';
import { isRecord, isUuid } from './workspace-validation';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';

export async function processWorkflowJobs(db: SupabaseClient): Promise<{ succeeded: number; skipped: number; failed: number }> {
  const due = await db.rpc('emit_workflow_due_events');
  if (due.error) throw databaseError(due.error);
  if (typeof due.data !== 'number' || !Number.isInteger(due.data) || due.data < 0 || due.data > 100) {
    throw new Error('Workflow due-event processing returned an invalid batch count.');
  }
  const internal = await db.rpc('execute_workflow_internal', { p_limit: 50 });
  if (internal.error) throw databaseError(internal.error);
  const count = (key: string): number => {
    const value = isRecord(internal.data) ? internal.data[key] : null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('Workflow processing returned invalid counters.');
    return value;
  };
  const counts = { succeeded: count('succeeded'), skipped: count('skipped'), failed: count('failed') };
  if (counts.succeeded + counts.skipped + counts.failed > 50) throw new Error('Workflow processing exceeded its 50-action batch.');
  const claimed = await db.rpc('claim_workflow_adapter_job');
  if (claimed.error) throw databaseError(claimed.error);
  if (claimed.data === null) return counts;
  if (!isRecord(claimed.data) || !isUuid(claimed.data.id)) throw new Error('Workflow claim returned an invalid job. Investigate its state before retrying.');
  const jobId = claimed.data.id;
  if (claimed.data.skipped === true) return { ...counts, skipped: counts.skipped + 1 };
  const job = claimed.data;
  let status: 'succeeded' | 'skipped' | 'failed' = 'succeeded';
  let error: string | null = null;
  let result: Record<string, unknown> = {};
  try {
    if (!isUuid(job.rule_id) || !isUuid(job.owner_id) || !isRecord(job.context) || !isUuid(job.context.lead_id)
      || typeof job.context.email !== 'string') throw new Error('Workflow claim lacks a verified lead, recipient or actor.');
    const definition = validateWorkflowDefinition(job.definition);
    if (definition.action.type !== 'enroll_sequence' && definition.action.type !== 'draft_sequence') throw new Error('A non-sequence job reached the sequence adapter.');
    const assignee = job.context.assignee;
    if (assignee !== null && !isUuid(assignee)) throw new Error('Workflow assignment is not an actual member identity.');
    const actor = assignee ?? job.owner_id;
    await requireMarketingConsent(db, job.context.email.trim().toLowerCase());
    const enrolled = await enrollLead(db, job.context.lead_id, actor, {
      jobId, ruleId: job.rule_id, draft: definition.action.type === 'draft_sequence', deadline: Date.now() + 20000,
    });
    if (!enrolled.enrollment) throw new WorkspaceError(enrolled.message ?? 'No eligible sequence was created.', 409);
    result = { enrollment_id: enrolled.enrollment.id, drafted: enrolled.drafted, manual_approval_required: true };
  } catch (failure) {
    status = failure instanceof WorkspaceError && failure.status < 500 ? 'skipped' : 'failed';
    error = failure instanceof Error ? failure.message : 'Workflow execution failed.';
    console.error('[workflow/sequence]', error);
  }
  const finished = await db.from('workflow_executions').update({ status, result, error, finished_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'running').select('id').single();
  if (finished.error || !finished.data || finished.data.id !== jobId) {
    throw new Error(`The workflow result could not be recorded: ${finished.error?.message ?? 'no verified result returned'}. Investigate the running job before retrying.`);
  }
  counts[status] += 1;
  return counts;
}

export async function runWorkflowAutomation(db: SupabaseClient, explicitActorId?: string): Promise<{
  status: 'succeeded' | 'partial'; summary: Record<string, unknown>; error?: string;
}> {
  let backlog: { released: number; skipped_stale: number } | null = null;
  if (explicitActorId) {
    const released = await db.rpc('release_workflow_backlog', { p_actor: explicitActorId });
    if (released.error) throw databaseError(released.error);
    if (!isRecord(released.data) || typeof released.data.released !== 'number' || !Number.isInteger(released.data.released)
      || released.data.released < 0 || typeof released.data.skipped_stale !== 'number'
      || !Number.isInteger(released.data.skipped_stale) || released.data.skipped_stale < 0) {
      throw new Error('Workflow backlog release returned invalid counters.');
    }
    backlog = { released: released.data.released, skipped_stale: released.data.skipped_stale };
  }
  const summary = await processWorkflowJobs(db);
  const result = backlog ? { ...summary, backlog_released: backlog.released, backlog_skipped_stale: backlog.skipped_stale } : summary;
  return { status: summary.failed ? 'partial' : 'succeeded', summary: result,
    ...(summary.failed ? { error: `${summary.failed} workflow actions failed. Review rule execution results before retrying.` } : {}) };
}
