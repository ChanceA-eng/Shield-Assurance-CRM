import type { SupabaseClient } from '@supabase/supabase-js';

export interface AutomationRun {
  id: string;
  job: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export async function trackedAutomation(
  db: SupabaseClient,
  job: string,
  execute: () => Promise<{ status: 'succeeded' | 'partial' | 'skipped'; summary: Record<string, unknown>; error?: string }>,
): Promise<AutomationRun> {
  const started = await db.from('automation_runs').insert({ job, status: 'running' }).select('*').single<AutomationRun>();
  if (started.error || !started.data) throw new Error(`Could not record ${job} start: ${started.error?.message ?? 'no run returned'}`);
  let outcome: { status: AutomationRun['status']; summary: Record<string, unknown>; error?: string };
  try { outcome = await execute(); }
  catch (error) {
    console.error(`[automation/${job}]`, error);
    outcome = { status: 'failed', summary: {}, error: error instanceof Error ? error.message : 'Automation failed.' };
  }
  const saved = await db.from('automation_runs').update({ ...outcome, error: outcome.error ?? null, finished_at: new Date().toISOString() })
    .eq('id', started.data.id).select('*').single<AutomationRun>();
  if (saved.error || !saved.data) throw new Error(`Could not record ${job} result: ${saved.error?.message ?? 'no run returned'}. Check the running job before retrying.`);
  return saved.data;
}
