'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { opportunityMetrics, type RecordedOutcome } from '../../lib/opportunity-metrics';
import { businessIntelligenceHref } from '../../lib/task-links';

interface Dashboard {
  watches: Array<{ id: string; target_type: 'lead' | 'client' | 'search'; target_id: string; enabled: boolean; last_evaluated_at: string | null; error: string | null; attempts: number }>;
  digests: Array<{ local_day: string; items: Array<{ type: 'lead' | 'client' | 'search'; id: string; name: string }> }>;
  searches: Array<{ id: string; name: string }>;
  outcomes: RecordedOutcome[];
  scheduler: { configured: boolean; active: boolean; last_job_at: string | null };
}
export default function OpportunityDashboard(): JSX.Element {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01-01`), [to, setTo] = useState(new Date().toISOString().slice(0, 10)), [search, setSearch] = useState('');
  const load = useCallback(async () => { setError(''); setData(await workspaceFetch<Dashboard>('/api/intelligence/operations')); }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'OIP dashboard could not be loaded.')); }, [load]);
  const watch = async (type: string, id: string, enabled: boolean): Promise<void> => {
    setBusy(true); setError('');
    try {
      await workspaceFetch('/api/intelligence/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'watch', type, id, enabled }) });
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Watch could not be updated.'); }
    finally { setBusy(false); }
  };
  const metrics = data && from <= to ? opportunityMetrics(data.outcomes, from, to) : [];
  return <section aria-label="Recurring intelligence and outcomes" className="space-y-3 rounded border border-cui-border bg-white p-3">
    <h2 className="text-sm font-semibold">Recurring intelligence and measured outcomes</h2>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    <button className="text-sm text-cui-primary underline" disabled={busy} onClick={() => void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Dashboard refresh failed.'))}>Refresh intelligence status</button>
    {data ? <>
      <p className="text-xs text-cui-muted">Scheduler: {data.scheduler.active ? 'enabled' : 'paused'} · {data.scheduler.configured ? 'authenticated heartbeat configured' : 'heartbeat configuration required'} · last evaluation claim: {data.scheduler.last_job_at ? new Date(data.scheduler.last_job_at).toLocaleString() : 'Not run'}</p>
      <details><summary className="cursor-pointer text-sm font-semibold">My watched records and saved searches</summary>
        <div className="my-2 flex flex-wrap gap-2"><select aria-label="Saved search to watch" className="rounded border border-cui-border p-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)}><option value="">Select my saved search</option>{data.searches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button disabled={busy || !search} className="text-sm text-cui-primary underline" onClick={() => void watch('search', search, true)}>Watch retained search results</button></div>
        <ul className="space-y-2 text-xs">{data.watches.map((item) => <li key={item.id} className="rounded border border-cui-border p-2">
          <Link className="text-cui-primary underline" href={item.target_type === 'search' ? '/leads/finder' : businessIntelligenceHref({ type: item.target_type, id: item.target_id })}>
            {item.target_type === 'search' ? data.searches.find((saved) => saved.id === item.target_id)?.name ?? 'Removed saved search' : 'Open watched business'}
          </Link> · {item.enabled ? 'Watching' : 'Paused'} · {item.last_evaluated_at ? new Date(item.last_evaluated_at).toLocaleString() : 'Not evaluated'}
          {item.error ? <p className="text-cui-danger">{item.error}{item.attempts >= 5 ? ' Paused after five attempts; resolve the issue, then re-enable this watch.' : ''}</p> : null}
          <button disabled={busy} className="ml-3 text-cui-primary underline" onClick={() => void watch(item.target_type, item.target_id, !item.enabled || item.attempts >= 5)}>{item.enabled && item.attempts < 5 ? 'Pause' : 'Resume / retry'}</button>
        </li>)}</ul>
        <p className="mt-2 text-xs text-cui-muted">Retained evidence is re-evaluated, not externally refreshed. No paid acquisition, AI calls, automatic tasks or customer sends.</p>
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Weekday digest history</summary>
        <ul className="mt-2 space-y-3 text-xs">{data.digests.map((item) => <li key={item.local_day}>{item.local_day} · {item.items.length} available changed items
          <ul className="list-inside list-disc">{item.items.map((entry) => <li key={`${entry.type}:${entry.id}`}><Link className="text-cui-primary underline"
            href={entry.type === 'search' ? '/leads/finder' : businessIntelligenceHref({ type: entry.type, id: entry.id })}>{entry.name} — review current evidence</Link></li>)}</ul>
        </li>)}</ul>
        {!data.digests.length ? <p className="mt-2 text-xs">No digest yet. Enable recurring evaluation in Settings and watch a business or saved search. Unchanged evidence is not repeatedly alerted.</p> : null}
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Source outcomes and costs</summary>
        <div className="my-3 flex flex-wrap gap-3 text-xs"><label>From<input type="date" className="ml-2 rounded border border-cui-border p-1" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" className="ml-2 rounded border border-cui-border p-1" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
        {from > to ? <p role="alert" className="text-xs text-cui-danger">Choose an end date on or after the start.</p> : null}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Source', 'Businesses', 'Verified', 'Qualified', 'Meetings', 'Submissions', 'Quotes', 'Bound', 'Cost', 'Cost/qualified', 'Quoted premium', 'Written premium'].map((heading) => <th className="whitespace-nowrap p-2" key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{metrics.map((row) => <tr key={row.source} className="border-t border-cui-border">{[row.source, row.businesses, row.stages.contact_verified, row.stages.qualified, row.stages.meeting, row.stages.submission, row.stages.quote, row.stages.bound, `$${row.cost.toFixed(2)}`, row.cost_per_qualified === null ? 'Not measured' : `$${row.cost_per_qualified.toFixed(2)}`, `$${row.quoted_premium.toFixed(2)}`, `$${row.written_premium.toFixed(2)}`].map((cell, index) => <td className="whitespace-nowrap p-2" key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
        {!metrics.length ? <p className="text-xs">No recorded outcomes in this date range.</p> : null}
        {metrics.map((row) => <p className="mt-2 text-xs" key={`${row.source}:rates`}>{row.source} recorded-business rates:
          {` verified contact ${((row.verified_rate ?? 0) * 100).toFixed(1)}%; qualified ${((row.qualified_rate ?? 0) * 100).toFixed(1)}%; meeting ${((row.meeting_rate ?? 0) * 100).toFixed(1)}%; submission ${((row.submission_rate ?? 0) * 100).toFixed(1)}%; bound ${((row.bind_rate ?? 0) * 100).toFixed(1)}%.`}
        </p>)}
        {metrics.map((row) => row.decline_reasons.length ? <p className="mt-2 text-xs" key={row.source}>{row.source} loss/decline reasons: {row.decline_reasons.join('; ')}</p> : null)}
        <p className="mt-2 text-xs text-cui-muted">Stage counts use distinct businesses. Premium uses the latest recorded quote or bind per business and source.</p>
      </details>
    </> : <p className="text-xs">{error ? 'Resolve the error before continuing.' : 'Loading intelligence operations...'}</p>}
  </section>;
}
