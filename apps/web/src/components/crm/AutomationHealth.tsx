'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import type { AutomationRun } from '../../lib/automation-health';

interface Job { job: string; latest: AutomationRun | null; last_success_at: string | null }

export default function AutomationHealth(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [runNotice, setRunNotice] = useState('');
  const load = useCallback(async (): Promise<void> => {
    try { setJobs((await workspaceFetch<{ jobs: Job[] }>('/api/automation/health')).jobs); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Automation health unavailable.'); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);
  const run = async (): Promise<void> => {
    setRunning(true);
    try {
      const result = await workspaceFetch<{ ok: boolean; message?: string }>('/api/cron/sync-leads', { method: 'GET' });
      setRunNotice(result.ok ? 'Automation finished. See persisted results below.' : result.message ?? 'Automation partially failed. See results below.');
    }
    catch (failure) { setRunNotice(failure instanceof Error ? failure.message : 'Automation failed.'); }
    finally { setRunning(false); await load(); }
  };
  return <details className="rounded-lg border border-cui-border bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold text-cui-text">Intake & automation health</summary>
    <p className="mt-2 text-xs text-cui-muted">Persisted run results, not browser refresh times. Running intake also processes due outreach and renewals; outreach can use AI drafting credits and send approved automation.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-cui-danger">{error}</p> : null}
    {runNotice ? <p role="status" className="mt-2 text-sm text-cui-text">{runNotice}</p> : null}
    <div className="mt-3 grid gap-3 md:grid-cols-2">{jobs.map((job) => <div key={job.job} className="rounded border border-cui-border p-3 text-xs">
      <p className="font-semibold">{job.job.replace(/-/g, ' ')}: <span className={!job.latest || ['failed', 'partial', 'skipped'].includes(job.latest.status) ? 'text-amber-800' : 'text-cui-text'}>{job.latest?.status ?? 'Not run yet'}</span></p>
      <p className="mt-1 text-cui-muted">Last success: {job.last_success_at ? `${formatArizonaDateTime(job.last_success_at)} AZ` : 'No successful run recorded'}</p>
      {job.latest?.status === 'running' ? <p className="mt-1 text-amber-800">Started {formatArizonaDateTime(job.latest.started_at)} AZ. If stale, investigate before retrying.</p> : null}
      {job.latest?.error ? <p className="mt-1 text-cui-danger">{job.latest.error}</p> : null}
    </div>)}</div>
    <button disabled={running} onClick={() => void run()} className="mt-3 rounded border border-cui-border px-3 py-2 text-xs font-semibold text-cui-primary disabled:opacity-40">{running ? 'Running...' : 'Run intake & due automation'}</button>
  </details>;
}
