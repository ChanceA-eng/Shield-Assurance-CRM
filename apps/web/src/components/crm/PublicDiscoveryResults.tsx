'use client';

import { useEffect, useState } from 'react';
import type { PublicDiscoveryPage, PublicDiscoveryBusiness } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

export interface PublicSearchRequest { source_id: string; query: string; state: string; start: number }

export default function PublicDiscoveryResults({ request, onPage, onAcquired, onBusyChange }: {
  request: PublicSearchRequest | null;
  onPage: (start: number) => void;
  onAcquired: (business: PublicDiscoveryBusiness, sourceId: string) => void;
  onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const [result, setResult] = useState<PublicDiscoveryPage | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    setResult(null); setError('');
    if (!request) return;
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ source_id: request.source_id, query: request.query, state: request.state, start: String(request.start) });
    void workspaceFetch<PublicDiscoveryPage>(`/api/intelligence/public-records?${params}`)
      .then((data) => { if (active) setResult(data); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Public-record search failed.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);
  const acquire = async (business: PublicDiscoveryBusiness): Promise<void> => {
    if (!request) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const key = `crm-public-acquisition:${request.source_id}:${business.dot_number}`;
      const id = sessionStorage.getItem(key) ?? crypto.randomUUID();
      sessionStorage.setItem(key, id);
      await workspaceFetch('/api/intelligence/public-records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: request.source_id, dot_number: business.dot_number, request_id: id }) });
      onAcquired(business, request.source_id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Business could not be acquired.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <Card><CardHeader>Public business matches</CardHeader><CardBody className="space-y-3">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {loading ? <p role="status" className="text-sm">Searching FMCSA public records...</p> : null}
    {!request ? <p className="text-sm text-cui-muted">Search a DOT-registered business by name. State filters each source page; this is not an all-industry directory.</p> : null}
    {result ? <>
      <p className="text-xs text-cui-muted">FMCSA QCMobile · retrieved {new Date(result.fetched_at).toLocaleString()}. Reported contacts are unverified. Insurance carrier, policy renewal and buying authority remain unknown.</p>
      {result.businesses.map((business) => <article key={business.dot_number} className="space-y-1 rounded border border-cui-border p-3 text-sm">
        <h3 className="font-semibold">{business.legal_name}</h3>
        <p className="break-words">{business.address || 'Address unknown'}</p>
        <p>DOT {business.dot_number} · {business.operating_status || 'Operating status unknown'}</p>
        {business.phone ? <p>Reported phone: {business.phone}</p> : null}
        <p className="text-xs">Reported power units: {business.power_units ?? 'Unknown'} · drivers: {business.drivers ?? 'Unknown'} · registration reported on: {business.registration_reported_on ?? 'Unknown'}</p>
        <button type="button" disabled={busy} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void acquire(business)}>Save business for review</button>
      </article>)}
      {!result.businesses.length ? <p className="text-sm">No matching businesses on this source page.{result.next_start !== null ? ' More source pages are available.' : ''}</p> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="text-cui-primary disabled:opacity-50" disabled={busy || loading || !request || request.start === 0} onClick={() => onPage(Math.max(0, (request?.start ?? 0) - 50))}>Previous source page</button>
        <button type="button" className="text-cui-primary disabled:opacity-50" disabled={busy || loading || result.next_start === null} onClick={() => { if (result.next_start !== null) onPage(result.next_start); }}>Next source page</button>
      </div>
    </> : null}
  </CardBody></Card>;
}
