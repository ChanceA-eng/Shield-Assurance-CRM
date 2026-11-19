'use client';

import { useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { formatArizonaDateTime } from '../../lib/arizona-time';

interface TermEvent { id: string; event: string; snapshot: Record<string, unknown>; recorded_by: string; recorded_at: string }

export default function PolicyTermHistory({ accountId, policyId }: { accountId: string; policyId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TermEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  useEffect(() => { setEvents([]); setLoaded(false); setOpen(false); setError(''); }, [accountId, policyId]);
  const load = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError('');
    try {
      const cursor = events.at(-1)?.id;
      const result = await workspaceFetch<TermEvent[]>(`/api/policies/history?account_id=${accountId}&id=${policyId}${cursor ? `&before_id=${cursor}` : ''}`);
      if (!Array.isArray(result)) throw new Error('Invalid policy history response.');
      setEvents((previous) => [...previous, ...result]); setMore(result.length === 100); setLoaded(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Policy history could not be loaded.'); }
    finally { busy.current = false; setLoading(false); }
  };
  return <section className="mt-3 border-t border-cui-border pt-3">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}
      className="text-xs font-semibold text-cui-primary">{open ? 'Hide' : 'View'} policy record history</button>
    {open ? <div className="mt-2 space-y-2">
      <p className="text-xs text-cui-muted">Revisions since policy-history tracking was enabled.</p>
      {events.map((event) => <details key={event.id} className="rounded border border-cui-border p-3">
        <summary className="cursor-pointer text-sm">{event.event} · {formatArizonaDateTime(event.recorded_at)} · {event.recorded_by}</summary>
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">{Object.entries(event.snapshot)
          .filter(([key, value]) => value !== null && typeof value !== 'object' && !['id', 'client_id', 'account_id'].includes(key))
          .map(([key, value]) => <div key={key}><dt className="text-cui-muted">{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>
      </details>)}
      {loaded && !events.length ? <p className="text-xs text-cui-muted">No tracked revisions. Older terms retain their existing account history.</p> : null}
      {loading ? <p role="status" className="text-xs text-cui-muted">Loading policy history...</p> : null}
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">Retry policy history</button></p> : null}
      {more && !error ? <button type="button" disabled={loading} onClick={() => void load()} className="text-xs text-cui-primary">Load older policy revisions</button> : null}
    </div> : null}
  </section>;
}
