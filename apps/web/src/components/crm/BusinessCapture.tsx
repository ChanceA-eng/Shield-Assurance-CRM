'use client';
import { useRef, useState } from 'react';
import type { DiscoverySource } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
const control = 'crm-input mt-1';
export default function BusinessCapture({ sources, onSaved }: { sources: DiscoverySource[]; onSaved: () => Promise<void> }): JSX.Element {
  const [values, setValues] = useState({ name: '', email: '', phone: '', address: '', line: '', selected_text: '', url: '', source_as_of: new Date().toISOString().slice(0, 10), source_id: '' });
  const [rights, setRights] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<{ key: string; id: string } | null>(null);
  return <details aria-label="Business capture" className="rounded border border-cui-border bg-white p-3">
    <summary className="cursor-pointer text-sm font-semibold">Capture selected business information</summary>
    {error ? <p role="alert" className="mt-2 text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 text-sm">{notice}</p> : null}
    <form className="mt-3 space-y-3" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError(''); setNotice('');
      const key = JSON.stringify(values);
      if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
      void (async () => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
        const storageKey = `crm-business-capture:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        const requestId = sessionStorage.getItem(storageKey) ?? pending.current?.id;
        if (!requestId) throw new Error('Capture retry identity could not be created.');
        sessionStorage.setItem(storageKey, requestId);
        await workspaceFetch('/api/intelligence/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, rights_confirmed: rights, request_id: requestId }) });
      })()
        .then(async () => { await onSaved(); setNotice('Captured for candidate review. Nothing was promoted or sent.'); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Business capture failed.'))
        .finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Approved source<select className={control} required value={values.source_id} onChange={(event) => setValues({ ...values, source_id: event.target.value })}><option value="">Choose source</option>{sources.filter((source) => source.active).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        {([['name', 'Business name'], ['url', 'Public source URL (no query tokens)'], ['source_as_of', 'Source as of'], ['email', 'Business email (optional)'], ['phone', 'Business phone (optional)'], ['address', 'Business address (optional)'], ['line', 'Coverage line (optional)']] as const).map(([field, label]) =>
          <label key={field} className="text-sm">{label}<input className={control} required={['name', 'url', 'source_as_of'].includes(field)} type={field === 'source_as_of' ? 'date' : field === 'url' ? 'url' : field === 'email' ? 'email' : 'text'} maxLength={field === 'url' ? 2000 : 255} value={values[field]} onChange={(event) => setValues({ ...values, [field]: event.target.value })} /></label>)}
        <label className="text-sm md:col-span-2">Explicitly selected business text<textarea className={control} required maxLength={10000} value={values.selected_text} onChange={(event) => setValues({ ...values, selected_text: event.target.value })} /></label>
        <label className="flex items-start gap-2 text-xs md:col-span-2"><input type="checkbox" required checked={rights} onChange={(event) => setRights(event.target.checked)} />I deliberately selected this business information and verified source permission for CRM retention/display/AI. No private page content, personal sensitive data or unrelated information. The CRM will not fetch the URL.</label>
        <button disabled={!rights} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Capture for review</button>
      </fieldset>
    </form>
  </details>;
}
