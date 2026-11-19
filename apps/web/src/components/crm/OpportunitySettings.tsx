'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_OPPORTUNITY_SETTINGS, type OpportunitySettings as Settings } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

const control = 'crm-input mt-1';
export default function OpportunitySettings(): JSX.Element {
  const [config, setConfig] = useState<Settings>({ ...DEFAULT_OPPORTUNITY_SETTINGS });
  const [revision, setRevision] = useState<number | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const data = await workspaceFetch<{ settings: { config: Settings; revision: number } }>('/api/intelligence/operations');
    setConfig(data.settings.config); setRevision(data.settings.revision);
  }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'OIP settings could not be loaded.')); }, [load]);
  return <Card><CardHeader>Lead targeting</CardHeader><CardBody>
    {error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="mb-3 text-sm">{notice}</p> : null}
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError(''); setNotice('');
      void workspaceFetch('/api/intelligence/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settings', revision, config }) })
        .then(async () => { await load(); setNotice('Targeting saved.'); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'OIP settings could not be saved.'))
        .finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy || revision === null} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {([['industries', 'Industries'], ['states', 'States (two-letter codes)'], ['lines', 'Coverage lines'], ['excluded_industries', 'Excluded industries']] as const).map(([field, label]) =>
            <label key={field} className="text-sm">{label}<input className={control} maxLength={1000} value={config[field]} onChange={(event) => setConfig({ ...config, [field]: event.target.value })} /></label>)}
          {(['revenue_min', 'revenue_max'] as const).map((field) => <label key={field} className="text-sm">{field === 'revenue_min' ? 'Minimum annual revenue' : 'Maximum annual revenue'}
            <input className={control} type="number" min={0} step="any" value={config[field] ?? ''} onChange={(event) => setConfig({ ...config, [field]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}
          {([['renewal_days', 'Renewal targeting window (days)', 1, 365], ['agent_capacity', 'Maximum digest items per agent', 1, 100],
            ['refresh_days', 'Re-evaluation interval (days)', 1, 365], ['digest_hour', 'Weekday digest hour (agency time zone)', 0, 23]] as const).map(([field, label, min, max]) =>
            <label key={field} className="text-sm">{label}<input className={control} type="number" min={min} max={max} required value={config[field]} onChange={(event) => setConfig({ ...config, [field]: Number(event.target.value) })} /></label>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={config.recurring_enabled} onChange={(event) => setConfig({ ...config, recurring_enabled: event.target.checked })} />
          Enable watched-record / saved-search re-evaluation and internal weekday digests</label>
        <button className="crm-button-primary">Save targeting</button>
      </fieldset>
    </form>
  </CardBody></Card>;
}
