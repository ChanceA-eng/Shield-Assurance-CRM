'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DiscoverySource } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

const control = 'crm-input mt-1';
export default function DiscoverySourceSettings(): JSX.Element {
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [name, setName] = useState(''), [reference, setReference] = useState(''), [until, setUntil] = useState('');
  const [rights, setRights] = useState(false), [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'file' | 'fmcsa'>('file');
  const [availability, setAvailability] = useState<{ fmcsa_configured: boolean; osha_configured: boolean } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const data = await workspaceFetch<{ sources: DiscoverySource[]; public_search?: { fmcsa_configured: boolean; osha_configured: boolean } }>('/api/intelligence/sources');
    setSources(data.sources);
    setAvailability(data.public_search ?? null);
  }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Source approvals could not be loaded.')); }, [load]);
  const save = async (body: unknown): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch('/api/intelligence/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load(); setNotice('Source approval saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Source approval could not be saved.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
    <Card><CardHeader>Lead discovery sources</CardHeader><CardBody>
      {availability ? <p className="mb-3 text-sm text-cui-muted">
        FMCSA {availability.fmcsa_configured ? 'connected' : 'unavailable'}; OSHA {availability.osha_configured ? 'connected' : 'unavailable'}.
      </p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void save({ config: {
        name, permission_reference: reference, acquisition_until: until, retained_crm_rights: rights, ...(provider === 'file' ? {} : { provider }),
      } }); }} className="space-y-3">
        <fieldset disabled={busy} className="space-y-3">
          <label className="block text-sm">Source type<select className={control} value={provider} onChange={(event) => setProvider(event.target.value === 'fmcsa' ? 'fmcsa' : 'file')}>
            <option value="file">Approved file / selected business capture</option><option value="fmcsa">FMCSA public business search</option>
          </select></label>
          <label className="block text-sm">Source name<input className={control} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block text-sm">Permission / contract reference<textarea className={control} required maxLength={1000} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="block text-sm">Acquisition approval ends (UTC)<input type="date" className={control} required value={until} onChange={(event) => setUntil(event.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={rights} onChange={(event) => setRights(event.target.checked)} className="mt-1" />
            I verified rights to acquire this source and retain its business data in the CRM for storage, agent display and AI processing after the acquisition period. No restricted or sensitive datasets. This is not marketing consent.</label>
          <button disabled={!rights} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve source</button>
        </fieldset>
      </form>
    </CardBody></Card>
    <Card><CardHeader>Saved approvals</CardHeader><CardBody className="space-y-3">
      {!sources.length ? <p className="text-sm text-cui-muted">No approved sources. Add a documented approval before acquiring files in Lead Finder.</p> : null}
      {sources.map((source) => <div key={source.id} className="rounded border border-cui-border p-3 text-sm">
        <p className="font-semibold">{source.name}</p>
        <p className="break-words text-cui-muted">{source.permission_reference}</p>
        <p>{source.provider === 'fmcsa' ? 'FMCSA public search' : 'File / capture'} · {source.active ? 'Active' : 'Paused'} · acquisition through {source.acquisition_until}</p>
        <button disabled={busy} className="mt-2 text-cui-primary underline" onClick={() => void save({
          id: source.id, expected_updated_at: source.updated_at, config: { active: !source.active },
        })}>{source.active ? 'Pause acquisitions' : 'Resume acquisitions'}</button>
      </div>)}
    </CardBody></Card>
  </div>;
}
