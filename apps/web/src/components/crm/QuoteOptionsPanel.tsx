'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordTarget } from '@crm/shared';
import { QUOTE_STATUSES, type QuoteOption, type QuoteHistoryEntry } from '../../lib/quote-options';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';

const empty = () => ({ carrier: '', line_of_business: '', premium: '', effective_date: '', expiration_date: '',
  limits: '', deductibles: '', notes: '', status: 'draft' });

function QuoteHistory({ endpoint, quote }: { endpoint: string; quote: QuoteOption }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuoteHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const load = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true); setError('');
    try {
      const cursor = items.at(-1)?.id;
      const rows = await workspaceFetch<QuoteHistoryEntry[]>(`${endpoint}&history_quote_id=${quote.id}${cursor === undefined ? '' : `&before_id=${cursor}`}`);
      if (!Array.isArray(rows)) throw new Error('The server returned an invalid quote history.');
      setItems((previous) => [...previous, ...rows]);
      setMore(rows.length === 100); setLoaded(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Quote history could not be loaded.');
    } finally { pending.current = false; setLoading(false); }
  };
  return <div className="mt-3">
    <button type="button" aria-expanded={open} aria-controls={`quote-history-${quote.id}`}
      onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}
      className="text-xs font-semibold text-cui-primary">{open ? 'Hide' : 'View'} history for {quote.carrier}</button>
    {open ? <section id={`quote-history-${quote.id}`} aria-label={`Quote history for ${quote.carrier}`}
      className="mt-2 space-y-3 rounded border border-cui-border bg-cui-body/40 p-3">
      <p className="text-xs text-cui-muted">Saved revisions, newest first. Times in Arizona. Historical quotes are not proof of binding or confirmed coverage.</p>
      {loading ? <p role="status" className="text-sm text-cui-muted">Loading quote history...</p> : null}
      {error ? <div role="alert" className="text-sm text-cui-danger">{error}
        <button type="button" disabled={loading} onClick={() => void load()} className="ml-2 font-semibold underline">Retry history</button></div> : null}
      {loaded && !items.length ? <p className="text-sm text-cui-muted">No saved revisions found.</p> : null}
      {items.map((entry) => <details key={entry.id} className="rounded border border-cui-border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-cui-text">
          {formatArizonaDateTime(entry.changed_at)} · {entry.snapshot.status} · {entry.snapshot.updated_by}
        </summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-cui-muted">Carrier</dt><dd>{entry.snapshot.carrier}</dd></div>
          <div><dt className="text-xs text-cui-muted">Line of business</dt><dd>{entry.snapshot.line_of_business}</dd></div>
          <div><dt className="text-xs text-cui-muted">Quoted premium</dt><dd>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(entry.snapshot.premium))}</dd></div>
          <div><dt className="text-xs text-cui-muted">Quoted term</dt><dd>{entry.snapshot.effective_date ?? 'Not set'} - {entry.snapshot.expiration_date ?? 'Not set'}</dd></div>
          {(['limits', 'deductibles', 'notes'] as const).map((field) => <div key={field} className="sm:col-span-2">
            <dt className="text-xs capitalize text-cui-muted">{field}</dt><dd className="whitespace-pre-wrap">{entry.snapshot[field] || 'Not recorded'}</dd>
          </div>)}
          <div className="sm:col-span-2"><dt className="text-xs text-cui-muted">Originally saved by</dt><dd>{entry.snapshot.created_by} · {formatArizonaDateTime(entry.snapshot.created_at)}</dd></div>
        </dl>
      </details>)}
      {more && !error ? <button type="button" disabled={loading} onClick={() => void load()}
        className="text-xs font-semibold text-cui-primary disabled:opacity-50">Load older revisions</button> : null}
    </section> : null}
  </div>;
}

export default function QuoteOptionsPanel({ target, refreshToken }: { target: RecordTarget; refreshToken?: string | null }): JSX.Element {
  const [items, setItems] = useState<QuoteOption[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<QuoteOption | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const saveId = useRef<string | null>(null);
  const endpoint = `/api/quote-options?record_type=${target.type}&record_id=${target.id}`;
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try { setItems(await workspacePages<QuoteOption>(endpoint, 100, 'page')); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Quote options could not be loaded.'); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load, refreshToken]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      saveId.current ??= crypto.randomUUID();
      await workspaceFetch<QuoteOption>(endpoint, { method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: editing?.id ?? saveId.current, expected_updated_at: editing?.updated_at }) });
      setOpen(false); setEditing(null); setForm(empty()); saveId.current = null;
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Quote save failed. Your draft is retained.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Manual quote options" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="font-semibold text-cui-text">Quote options</h3>
        <p className="text-xs text-cui-muted">Manual carrier quotes. Acceptance does not bind coverage or mark a lead Won. Link the correct account before saving.</p></div>
      <button type="button" disabled={open || loading} onClick={() => { setForm(empty()); setEditing(null); saveId.current = null; setOpen(true); }}
        className="shrink-0 rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Add quote option</button>
    </div>
    {error ? <p role="alert" className="rounded border border-cui-danger/30 bg-cui-danger/10 p-3 text-sm text-cui-danger">{error}
      <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Refresh quotes</button></p> : null}
    {open ? <form aria-label="Quote option form" onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3 rounded border border-cui-border bg-white p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(['carrier', 'line_of_business', 'premium', 'effective_date', 'expiration_date'] as const).map((key) =>
          <label key={key} className="block text-xs font-semibold text-cui-text">{key[0].toUpperCase() + key.slice(1).replaceAll('_', ' ')}
            <input required={['carrier', 'line_of_business', 'premium'].includes(key)} type={key === 'premium' ? 'number' : key.endsWith('_date') ? 'date' : 'text'}
              min={key === 'premium' ? 0 : undefined} step={key === 'premium' ? '0.01' : undefined}
              value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
              className="mt-1 w-full rounded border border-cui-border px-2 py-2 text-sm font-normal" />
          </label>)}
        <label className="block text-xs font-semibold text-cui-text">Quote status
          <select value={form.status} onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))}
            className="mt-1 w-full rounded border border-cui-border px-2 py-2 text-sm font-normal">
            {QUOTE_STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
          </select>
        </label>
      </div>
      {(['limits', 'deductibles', 'notes'] as const).map((key) => <label key={key} className="block text-xs font-semibold capitalize text-cui-text">{key}
        <textarea value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
          className="mt-1 w-full rounded border border-cui-border px-2 py-2 text-sm font-normal" rows={2} />
      </label>)}
      <div className="flex gap-2"><button disabled={busy} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save quote option'}</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setEditing(null); saveId.current = null; }} className="rounded border border-cui-border px-3 py-2 text-sm">Cancel</button></div>
    </form> : null}
    {loading ? <p className="text-sm text-cui-muted">Loading quote options...</p> : !items.length && !error ? <p className="text-sm text-cui-muted">No saved quote options.</p> : null}
    {items.map((item) => <article key={item.id} className="rounded border border-cui-border bg-white p-3">
      <div className="flex justify-between gap-2"><h4 className="font-semibold text-cui-text">{item.carrier} · {item.line_of_business}</h4>
        <span className="text-xs font-semibold capitalize text-cui-primary">{item.status}</span></div>
      <p className="mt-1 text-sm font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(item.premium))}</p>
      <p className="text-xs text-cui-muted">{item.effective_date ?? 'Effective date not set'} - {item.expiration_date ?? 'Expiration not set'}</p>
      {item.limits ? <p className="mt-2 whitespace-pre-wrap text-sm">Limits: {item.limits}</p> : null}
      {item.deductibles ? <p className="whitespace-pre-wrap text-sm">Deductibles: {item.deductibles}</p> : null}
      {item.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-cui-muted">{item.notes}</p> : null}
      <button type="button" disabled={open} onClick={() => { setEditing(item); setForm({ ...item, premium: String(item.premium),
        effective_date: item.effective_date ?? '', expiration_date: item.expiration_date ?? '' }); setOpen(true); setError(''); }}
        className="mt-2 text-xs font-semibold text-cui-primary disabled:opacity-50">Edit quote from {item.carrier}</button>
      {item.status === 'accepted' ? <button type="button" onClick={() => window.location.assign(
        `/policies?account_id=${item.client_id}&quote_id=${item.id}${target.type === 'lead' && item.lead_id === target.id ? `&lead_id=${target.id}` : ''}`)}
        className="ml-3 mt-2 text-xs font-semibold text-cui-primary">Record policy from {item.carrier}</button> : null}
      <QuoteHistory key={`${endpoint}:${item.id}:${item.updated_at}`} endpoint={endpoint} quote={item} />
    </article>)}
  </section>;
}
