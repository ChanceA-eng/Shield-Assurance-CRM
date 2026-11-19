'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OpportunityWorkspace } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { businessIntelligenceHref } from '../../lib/task-links';
import OpportunityDashboard from './OpportunityDashboard';

function Reviews(): JSX.Element {
  const [page, setPage] = useState(0), [items, setItems] = useState<OpportunityWorkspace[]>([]);
  const [more, setMore] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0), [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setItems([]); setMore(false);
    void workspaceFetch<{ items: OpportunityWorkspace[]; has_more: boolean }>(`/api/intelligence/opportunities?page=${page}`)
      .then((result) => { if (active) { setItems(result.items); setMore(result.has_more); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Business reviews could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, refresh]);
  return <div className="mt-3 space-y-3">
    <button type="button" disabled={loading} className="text-sm text-cui-primary underline" onClick={() => setRefresh((old) => old + 1)}>Refresh business reviews</button>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {loading ? <p role="status" className="text-sm">Evaluating current carrier guidance...</p> : null}
    {items.map((item) => <Link key={item.profile.scope_key} href={businessIntelligenceHref(item.target)}
      className="block rounded border border-cui-border bg-white p-3">
      <h3 className="text-sm font-semibold">{item.record_name} · {item.assessment.status.replace(/_/g, ' ')}</h3>
      <p className="mt-1 text-xs">{item.assessment.next_step}</p>
      <p className="mt-1 text-xs text-cui-muted">Possible markets: {item.assessment.markets.filter((market) => market.status === 'possible_fit').map((market) => market.carrier).join(', ') || 'Needs review'}</p>
    </Link>)}
    {!items.length && !loading && !error ? <p className="text-sm">Review business matching facts in a lead or account to include it here.</p> : null}
    <div className="flex gap-3 text-sm"><button disabled={loading || page === 0} onClick={() => setPage((old) => old - 1)}>Previous reviews</button><span>Page {page + 1}</span><button disabled={loading || !more} onClick={() => setPage((old) => old + 1)}>Next reviews</button></div>
    <details onToggle={(event) => { if (event.currentTarget.open) setShowHistory(true); }}>
      <summary className="cursor-pointer text-sm text-cui-primary">Watches, digests and source outcomes</summary>
      {showHistory ? <div className="mt-3"><OpportunityDashboard /></div> : null}
    </details>
  </div>;
}

export default function OpportunityQueue({ initiallyOpen = false }: { initiallyOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen), [loaded, setLoaded] = useState(initiallyOpen);
  useEffect(() => { if (initiallyOpen) { setOpen(true); setLoaded(true); } }, [initiallyOpen]);
  return <details id="business-reviews" className="mt-4 rounded border border-cui-border bg-white p-3" open={open}
    onToggle={(event) => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setLoaded(true); }}>
    <summary className="cursor-pointer text-sm font-semibold">Business reviews and next actions</summary>
    {loaded ? <Reviews /> : null}
  </details>;
}
