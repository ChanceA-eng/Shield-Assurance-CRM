'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import type { AutomationRun } from '../../lib/automation-health';
import { Card, CardBody, CardHeader } from '../ui/Card';

interface Job { job: string; latest: AutomationRun | null; last_success_at: string | null }
interface Scheduler {
  configured: boolean;
  jobs: Array<{ name: string; schedule: string; active: boolean }>;
  last_heartbeat: { status: string; started_at: string; finished_at: string | null; error: string | null } | null;
}
interface Preview { job: string; revision: number; records: number; may_use_ai: boolean; may_send_email: boolean; workflow_revision?: number }
const jobNames = [
  ['follow-up-routine', 'Pipeline follow-ups'], ['due-reminders', 'Due reminders'], ['renewal-radar', 'Renewal radar'],
  ['internal-actions', 'Internal work reconciliation'], ['outreach', 'Due outreach'], ['custom-workflows', 'Custom rules'],
] as const;

export default function AutomationHealth({ active = true }: { active?: boolean }): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scheduler, setScheduler] = useState<Scheduler | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [job, setJob] = useState<string>('follow-up-routine');
  const [preview, setPreview] = useState<Preview | null>(null);
  const load = useCallback(async (): Promise<void> => {
    const [health, schedule] = await Promise.all([
      workspaceFetch<{ jobs: Job[] }>('/api/automation/health'),
      workspaceFetch<Scheduler>('/api/settings/automation/scheduler'),
    ]);
    setJobs(health.jobs); setScheduler(schedule);
  }, []);
  useEffect(() => {
    if (!active) return;
    const refresh = (): void => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Automation results could not load.')); };
    refresh(); const timer = setInterval(refresh, 30000); return () => clearInterval(timer);
  }, [load, active]);
  const enabled = scheduler?.jobs.length === 2 && scheduler.jobs.every((entry) => entry.active);
  const schedule = async (): Promise<void> => {
    if (!enabled && !window.confirm('Enable background processing? Due outreach can draft with AI and send only under the saved approval, consent and delivery controls.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workspaceFetch<Scheduler>('/api/settings/automation/scheduler', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }),
      });
      setScheduler(result); setNotice(enabled ? 'Background scheduling paused. Existing work is preserved.' : 'Background scheduling enabled.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Scheduling could not change.'); }
    finally { setBusy(false); }
  };
  const inspect = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try { setPreview(await workspaceFetch<Preview>(`/api/automation/run?job=${encodeURIComponent(job)}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Preview could not load.'); }
    finally { setBusy(false); }
  };
  const run = async (): Promise<void> => {
    if (!preview || !window.confirm(`Run ${jobNames.find(([id]) => id === preview.job)?.[1] ?? preview.job}?${preview.may_send_email
      ? ' Eligible outreach may use AI and send authorized email.' : preview.may_use_ai
        ? ' May enroll consented leads and draft with AI. Manual approval is required; this job sends no email.'
        : preview.job === 'custom-workflows' ? ' May update internal work or enroll consented leads. This job sends no email.'
          : ' This can update internal tasks and notifications.'}`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workspaceFetch<{ ok: boolean; run: AutomationRun }>('/api/automation/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: preview.job, expected_revision: preview.revision, confirmed: true,
          ...(preview.job === 'custom-workflows' ? { expected_workflow_revision: preview.workflow_revision } : {}) }),
      });
      setNotice(result.ok ? 'Run finished.' : result.run.error ?? 'Run did not finish. Check its result before retrying.');
      setPreview(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Automation failed.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {error ? <div className="flex items-center justify-between gap-3"><p role="alert" className="text-sm text-cui-danger">{error}</p>
      <button disabled={busy} onClick={() => { void load().then(() => setError('')).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Results could not reload.')); }} className="text-sm font-semibold text-cui-primary underline">Retry loading</button></div> : null}
    {notice ? <p role="status" className="text-sm text-cui-text">{notice}</p> : null}
    <Card><CardHeader actions={<button type="button" disabled={busy} onClick={() => { void load().then(() => setError('')).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Status could not be refreshed.')); }} className="text-sm font-semibold text-cui-primary underline disabled:opacity-50">Refresh status</button>}>Background scheduling</CardHeader><CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p className="text-sm font-semibold">{enabled ? 'Enabled' : scheduler ? scheduler.configured ? 'Paused' : 'Unavailable' : 'Loading...'}</p>
        <p className="mt-1 text-xs text-cui-muted">Reminders every minute; due work every five minutes. No open browser required.</p>
        {scheduler?.last_heartbeat ? <p className="mt-1 text-xs text-cui-muted">Last check: {scheduler.last_heartbeat.status} - {formatArizonaDateTime(scheduler.last_heartbeat.started_at)} AZ</p> : null}
        {scheduler?.last_heartbeat?.error ? <p role="alert" className="mt-1 text-sm text-cui-danger">The last background check failed. Refresh to check again, or contact support.</p> : null}
        {scheduler && !scheduler.configured ? <p role="alert" className="mt-1 text-sm text-cui-danger">Background scheduling is unavailable. Contact support.</p> : null}
      </div>
      <button disabled={busy || !scheduler?.configured} onClick={() => void schedule()} className="h-9 rounded border border-cui-border px-3 text-sm font-semibold text-cui-primary disabled:opacity-50 max-sm:h-11">{enabled ? 'Pause background scheduling' : 'Enable background scheduling'}</button>
    </CardBody></Card>
    <Card><CardHeader>Run one job</CardHeader><CardBody className="space-y-3 py-3">
      <div className="flex flex-wrap gap-2"><select aria-label="Automation job" disabled={busy} value={job}
        onChange={(event) => { setJob(event.target.value); setPreview(null); }} className="h-9 rounded border border-cui-border px-3 text-sm max-sm:h-11">
        {jobNames.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select><button disabled={busy} onClick={() => void inspect()} className="h-9 rounded border border-cui-border px-3 text-sm font-semibold text-cui-primary max-sm:h-11">Preview</button></div>
      {preview ? <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">{preview.records} records to inspect. {preview.may_send_email ? 'May draft with AI and send authorized email.'
          : preview.may_use_ai ? 'May draft with AI; manual approval required. No email sent by this job.'
            : preview.job === 'custom-workflows' ? 'May update internal work or enroll consented leads; no email or AI.' : 'Internal work only; no email or AI.'}</p>
        <button disabled={busy} onClick={() => void run()} className="h-9 rounded bg-cui-primary px-3 text-sm font-semibold text-white max-sm:h-11">Run this job</button>
      </div> : null}
    </CardBody></Card>
    <Card><CardHeader>Run results</CardHeader><CardBody className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm"><thead className="bg-cui-body/40 text-xs text-cui-muted"><tr>
        <th className="px-3 py-2">Job</th><th className="px-3 py-2">Latest</th><th className="px-3 py-2">Last success - AZ</th>
      </tr></thead><tbody>{jobs.map((entry) => <tr key={entry.job} className="border-t border-cui-border">
        <th className="px-3 py-3 font-medium">{entry.job.replaceAll('-', ' ')}</th>
        <td className="px-3 py-3">{entry.latest?.status ?? 'Not run yet'}{entry.latest?.error ? <p className="mt-1 text-xs text-cui-danger">{entry.latest.error}</p> : null}</td>
        <td className="px-3 py-3 text-xs text-cui-muted">{entry.last_success_at ? formatArizonaDateTime(entry.last_success_at) : 'No successful run recorded'}</td>
      </tr>)}</tbody></table>
    </CardBody></Card>
  </div>;
}
