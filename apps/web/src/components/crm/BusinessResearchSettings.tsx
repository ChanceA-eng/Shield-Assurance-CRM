'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';
import type { ResearchCoverage, ResearchSource } from '@crm/shared';

interface Configuration {
  settings: { enabled: boolean; tasks_enabled: boolean; task_capacity: number; task_due_days: number; refresh_days: number; revision: number };
  sources: Array<{ provider: ResearchSource; enabled: boolean; retained_rights: boolean; reference: string; revision: number }>;
  incomplete_jobs: Array<{ business_id: string; error: string | null; attempts: number; coverage: ResearchCoverage[] | null }>;
  partitions: Array<{ provider: 'irs' | 'dol_5500' | 'osm'; state: string; status: string; cursor: number; error: string | null }>;
}
const labels = { fmcsa_census: 'FMCSA Company Census', osm: 'OpenStreetMap businesses (ODbL)', irs: 'IRS exempt organizations', dol_5500: 'DOL Form 5500 employer filings' };
export default function BusinessResearchSettings(): JSX.Element {
  const [data, setData] = useState<Configuration | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setData(await workspaceFetch<Configuration>('/api/intelligence/business-research-settings')); }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Research settings could not be loaded.')); }, [load]);
  return <Card><CardHeader>Automatic business research</CardHeader><CardBody className="space-y-3">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
    {data ? <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError(''); setNotice('');
      void workspaceFetch('/api/intelligence/business-research-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: data.settings.revision, config: data.settings, sources: data.sources }) })
        .then(async () => { await load(); setNotice('Research settings saved.'); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Research settings could not be saved.')).finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.enabled}
          onChange={(event) => setData({ ...data, settings: { ...data.settings, enabled: event.target.checked } })} />Enable Lead Finder and automatic research</label>
        <div className="space-y-2">{data.sources.map((source) => <div key={source.provider} className="rounded border border-cui-border p-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={source.enabled} onChange={(event) => setData({ ...data,
            sources: data.sources.map((item) => item.provider === source.provider ? { ...item, enabled: event.target.checked } : item) })} />{labels[source.provider]}</label>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={source.retained_rights} onChange={(event) => setData({ ...data,
            sources: data.sources.map((item) => item.provider === source.provider ? { ...item, retained_rights: event.target.checked, enabled: event.target.checked && item.enabled } : item) })} />Allow retained public-business research under the source terms</label>
          <a className="mt-1 inline-block text-xs text-cui-primary underline" href={source.reference} target="_blank" rel="noopener noreferrer">Source and usage terms</a>
        </div>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.tasks_enabled}
          onChange={(event) => setData({ ...data, settings: { ...data.settings, tasks_enabled: event.target.checked } })} />Create internal tasks for saved or linked businesses</label>
        <div className="grid gap-3 sm:grid-cols-3">{([['task_capacity', 'Tasks per agent / day', 100], ['task_due_days', 'Task due in days', 30], ['refresh_days', 'Refresh source records (days)', 365]] as const).map(([field, label, max]) =>
          <label key={field} className="text-sm">{label}<input type="number" min={1} max={max} required step={1} className="mt-1 w-full rounded border border-cui-border px-3 py-2"
            value={data.settings[field]} onChange={(event) => setData({ ...data, settings: { ...data.settings, [field]: Number(event.target.value) } })} /></label>)}</div>
        <button className="crm-button-primary">Save research settings</button>
      </fieldset>
    </form> : !error ? <p role="status" className="text-sm">Loading research settings...</p> : null}
    {data?.partitions.some((partition) => partition.status === 'failed') ? <section aria-label="Source repairs"><h3 className="text-sm font-semibold">Sources needing attention</h3>
      <ul className="mt-3 space-y-2">{data.partitions.filter((partition) => partition.status === 'failed').map((partition) => <li key={`${partition.provider}:${partition.state}`} className="rounded-lg border border-cui-border p-3 text-sm">
        <p className="font-semibold">{labels[partition.provider]} - {partition.state}</p>
        {partition.error ? <p role="alert" className="mt-1 text-cui-danger">{partition.error}</p> : null}
        {partition.status === 'failed' ? <button type="button" disabled={busy} className="text-cui-primary underline" onClick={() => {
          setBusy(true); setError('');
          void workspaceFetch('/api/intelligence/business-research-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'retry_index', provider: partition.provider, state: partition.state }) }).then(load)
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Directory retry failed.')).finally(() => setBusy(false));
        }}>Retry source</button> : null}
      </li>)}</ul>
    </section> : null}
    {data?.incomplete_jobs.length ? <section aria-label="Research repairs"><h3 className="text-sm font-semibold">Research needing attention ({data.incomplete_jobs.length})</h3>
      <ul className="mt-3 space-y-3">{data.incomplete_jobs.map((job, index) => <li key={job.business_id} className="flex flex-wrap items-center gap-2 text-sm">
        <span>Business check {index + 1}</span>
        {job.error ? <span role="alert" className="text-cui-danger">{job.error}</span> : null}
        {job.coverage?.filter((item) => item.state === 'unavailable').map((item) =>
          <span key={item.source} role="alert" className="text-cui-danger">{item.source}: {item.message}</span>)}
        <button disabled={busy} className="text-cui-primary underline" onClick={() => {
          setBusy(true); setError('');
          void workspaceFetch('/api/intelligence/business-research-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'retry', business_id: job.business_id }) }).then(load)
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Research retry failed.')).finally(() => setBusy(false));
        }}>Retry research</button>
      </li>)}</ul>
    </section> : null}
  </CardBody></Card>;
}
