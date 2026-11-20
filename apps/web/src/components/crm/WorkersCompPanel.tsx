'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpportunityMarket, RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { WC_FIELDS, WC_KINDS, WC_OFFICIAL_URL, parseWcEvidence, suggestWcFields, wcEntryStatus, wcFieldsFor,
  type WcEvidence, type WcField, type WcWorkspace } from '../../lib/workers-comp';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

const today = (): string => new Date().toISOString().slice(0, 10);
const empty = (name: string, address: string): WcEvidence => ({
  kind: 'policy', source_name: '', source_date: '', employer_name: name, employer_address: address,
  identity: 'possible', fields: {}, pages: {},
});
const failureMessage = (error: unknown): string => error instanceof Error ? error.message : 'These details could not load. Please try again.';

export default function WorkersCompPanel({ target, businessName = '', address = '' }: {
  target?: RecordTarget; businessName?: string; address?: string;
}): JSX.Element {
  const [workspace, setWorkspace] = useState<WcWorkspace | null>(null);
  const [draft, setDraft] = useState<WcEvidence>(() => empty(businessName, address));
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [markets, setMarkets] = useState<OpportunityMarket[] | null>(null), [progress, setProgress] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const job = useRef<AbortController | null>(null);
  const source = useRef<string | null>(null);
  useUnsavedChanges(Boolean(editing));
  const endpoint = target ? `/api/workers-comp?type=${target.type}&id=${target.id}` : null;
  const load = async (): Promise<void> => {
    if (!endpoint) return;
    setError(''); setBusy(true);
    try { setWorkspace(await workspaceFetch<WcWorkspace>(endpoint)); }
    catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    if (endpoint) {
      void workspaceFetch<WcWorkspace>(endpoint).then((value) => { if (active) setWorkspace(value); })
        .catch((failure: unknown) => { if (active) setError(failureMessage(failure)); });
    }
    return () => { active = false; job.current?.abort(); if (source.current) URL.revokeObjectURL(source.current); };
  }, [endpoint]);
  const closeEditor = (): void => {
    job.current?.abort(); job.current = null;
    if (source.current) URL.revokeObjectURL(source.current);
    source.current = null; setSourceUrl(null); setProgress(''); setEditing(null);
  };
  const changeField = (field: WcField, value: string): void => {
    setDraft((current) => {
      const pages = { ...current.pages };
      if (!value) delete pages[field];
      return { ...current, fields: { ...current.fields, [field]: value }, pages };
    });
  };
  const readFile = async (file: File): Promise<void> => {
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller; setError(''); setProgress('Reading document on this device...');
    if (source.current) URL.revokeObjectURL(source.current);
    source.current = URL.createObjectURL(file); setSourceUrl(source.current);
    try {
      const { extractPolicyInBrowser } = await import('../../lib/browser-policy-extraction');
      const document = await extractPolicyInBrowser(file, controller.signal, (message) => { if (!controller.signal.aborted) setProgress(message); });
      if (controller.signal.aborted) return;
      const suggestions = suggestWcFields(document.pages, draft.kind);
      if (draft.kind === 'policy') {
        for (const [field, intake] of [['carrier', 'carrier'], ['policy_from', 'effective_date'], ['policy_to', 'expiration_date']] as const) {
          const candidates = document.suggestions.filter((item) => item.field === intake);
          if (candidates.length && new Set(candidates.map((item) => item.value)).size === 1) {
            suggestions.fields[field] = candidates[0].value; suggestions.pages[field] = candidates[0].page;
          }
        }
      }
      setDraft((current) => ({ ...current, source_name: current.source_name || WC_KINDS[current.kind],
        fields: { ...current.fields, ...suggestions.fields }, pages: { ...current.pages, ...suggestions.pages } }));
      setProgress(Object.keys(suggestions.fields).length ? 'Suggested totals are ready. Check them against the document.' : 'Enter the reported fields below. The source stays on this device.');
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failureMessage(failure)); setProgress(''); }
    } finally { if (job.current === controller) job.current = null; }
  };
  return <section aria-label="Workers' comp" className="space-y-3">
    <h4 className="font-semibold">Arizona workers&apos; comp</h4>
    <div className="space-y-2">
      <p className="text-sm">{workspace?.record_name || businessName || "Use the employer's legal name and business address."}</p>
      {(workspace?.record_address || address) ? <p className="text-xs text-cui-muted">{workspace?.record_address || address}</p> : null}
      <div className="flex flex-wrap gap-2">
        <a className="crm-button" href={WC_OFFICIAL_URL} target="_blank" rel="noopener noreferrer">Arizona coverage resources</a>
        <button type="button" className="crm-button" onClick={() => {
          setError('');
          void navigator.clipboard.writeText(workspace?.record_name || businessName).then(() => setNotice('Business name copied.'))
            .catch(() => setError('Copy was unavailable. Select and copy the business name above.'));
        }} disabled={!(workspace?.record_name || businessName)}>Copy business name</button>
      </div>
      {!target && error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {!target && notice ? <p role="status" className="text-xs">{notice}</p> : null}
    </div>
    {!target ? <p className="text-sm text-cui-muted">Open a saved lead or account to add private workers&apos; comp documents.</p> : <>
      {error ? <div role="alert" className="text-sm text-cui-danger">{error}
        {!workspace ? <button type="button" className="crm-button ml-2" onClick={() => { void load(); }}>Retry</button> : null}</div> : null}
      {notice ? <p role="status" className="text-xs">{notice}</p> : null}
      {!workspace && !error ? <p role="status">Loading private documents...</p> : null}
      {workspace ? <>
        {!workspace.entries.length ? <p>No workers&apos; comp documents added. Add a policy, mod worksheet, payroll summary or loss run.</p> : null}
        {workspace.entries.map((entry) => <article key={entry.id} className="space-y-2 rounded border border-cui-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h5 className="font-semibold">{entry.evidence.source_name}</h5>
              <p className="text-xs">{WC_KINDS[entry.evidence.kind]} · Reported {entry.evidence.source_date} · {wcEntryStatus(entry, today())}</p></div>
            <button type="button" className="crm-button" disabled={busy || Boolean(editing)} onClick={() => {
              setDraft(structuredClone(entry.evidence)); setEditing({ id: entry.id, revision: entry.revision }); setError(''); setNotice('');
            }}>Review / correct</button>
          </div>
          <p className="text-xs">{entry.evidence.employer_name} · {entry.evidence.employer_address}</p>
          <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">{Object.entries(entry.evidence.fields).map(([field, value]) => {
            const key = field as WcField;
            return <div key={field}><dt className="text-xs text-cui-muted">{WC_FIELDS[key][0]}</dt>
              <dd>{value}{entry.evidence.pages[key] ? ` · page ${entry.evidence.pages[key]}` : ''}</dd></div>;
          })}</dl>
          {entry.evidence.kind === 'loss_run' ? <p className="text-xs text-cui-muted">Only the reported period is shown. Missing years or fields are unknown, not zero losses.</p> : null}
          <button type="button" className="text-xs text-cui-danger underline" disabled={busy || Boolean(editing)} onClick={() => {
            if (!window.confirm("Remove this source and its reviewed workers' comp facts?")) return;
            setBusy(true); setError('');
            void workspaceFetch<WcWorkspace>('/api/workers-comp', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...target, entry_id: entry.id, revision: entry.revision }) })
              .then((value) => { setWorkspace(value); setMarkets(null); })
              .catch((failure: unknown) => setError(failureMessage(failure))).finally(() => setBusy(false));
          }}>Remove source</button>
        </article>)}
        {!editing ? <button type="button" className="crm-button crm-button-primary" disabled={busy} onClick={() => {
          setDraft(empty(workspace.record_name, workspace.record_address)); setEditing({ id: crypto.randomUUID(), revision: 0 }); setError(''); setNotice('');
        }}>Add document facts</button> : null}
        {editing ? <form aria-label="Workers' comp document review" className="space-y-3 rounded border border-cui-border p-3" onSubmit={(event) => {
          event.preventDefault(); setError(''); setBusy(true);
          let evidence: WcEvidence;
          try { evidence = parseWcEvidence(draft); }
          catch (failure) { setError(failureMessage(failure)); setBusy(false); return; }
          void workspaceFetch<WcWorkspace>('/api/workers-comp', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...target, entry_id: editing.id, revision: editing.revision, evidence }) })
            .then((value) => { setWorkspace(value); setMarkets(null); setNotice('Reviewed facts saved.'); closeEditor(); })
            .catch((failure: unknown) => setError(failureMessage(failure))).finally(() => setBusy(false));
        }}><fieldset disabled={busy} className="space-y-3">
          <p className="text-xs text-cui-muted">Use employer-level summaries or redacted documents. Files are read on your device, not uploaded.
            Only the fields you review below are saved. Do not enter claimant names, medical details or employee-level payroll.</p>
          <label className="block text-xs">Document type<select className="crm-input mt-1" value={draft.kind} disabled={busy || Boolean(progress && job.current)}
            onChange={(event) => {
              const kind = event.target.value as WcEvidence['kind'];
              setDraft((current) => ({ ...current, kind, fields: {}, pages: {} })); setProgress('');
            }}>{Object.entries(WC_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block text-xs">Read a document (optional)<input className="mt-1 block w-full" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={busy || Boolean(job.current)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ''; }} /></label>
          {progress ? <p role="status" className="text-xs">{progress}</p> : null}
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-cui-primary underline">View source on this device</a> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([['source_name', 'Source name'], ['source_date', 'Document report date'], ['employer_name', 'Employer legal name / DBA'],
              ['employer_address', 'Arizona business address']] as const).map(([key, label]) =>
              <label key={key} className="block text-xs">{label}<input required className="crm-input mt-1" type={key === 'source_date' ? 'date' : 'text'}
                max={key === 'source_date' ? today() : undefined} value={draft[key]} maxLength={key === 'employer_address' ? 200 : 160}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
            <label className="block text-xs">Business match<select className="crm-input mt-1" value={draft.identity}
              onChange={(event) => setDraft((current) => ({ ...current, identity: event.target.value as WcEvidence['identity'] }))}>
              <option value="possible">Possible match - do not use for matching</option><option value="confirmed">I checked the name and business location</option>
            </select></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{wcFieldsFor(draft.kind).map((field) => <div key={field}>
            <label className="block text-xs">{WC_FIELDS[field][0]}
              {field === 'payroll_basis' || field === 'loss_completeness' ? <select className="crm-input mt-1" value={draft.fields[field] ?? ''}
                onChange={(event) => changeField(field, event.target.value)}><option value="">Not reported</option>
                {(field === 'payroll_basis' ? ['estimated', 'reported', 'audited'] : ['complete', 'partial']).map((item) => <option key={item} value={item}>{item}</option>)}
              </select> : <input className="crm-input mt-1" type={WC_FIELDS[field][1]} step="any" min={WC_FIELDS[field][1] === 'number' ? '0' : undefined}
                maxLength={200} value={draft.fields[field] ?? ''} onChange={(event) => changeField(field, event.target.value)} />}
            </label>
            {draft.fields[field] ? <label className="mt-1 block text-xs text-cui-muted">Source page (optional)<input className="crm-input mt-1" aria-label={`Source page for ${WC_FIELDS[field][0]}`}
              type="number" min="1" max="1000" value={draft.pages[field] ?? ''} onChange={(event) => setDraft((current) => {
                const pages = { ...current.pages };
                if (event.target.value) pages[field] = Number(event.target.value); else delete pages[field];
                return { ...current, pages };
              })} /></label> : null}
          </div>)}</div>
          <p className="text-xs text-cui-muted">Leave unreported values empty. Policy end dates do not confirm a future renewal.</p>
          <div className="flex gap-2"><button type="submit" className="crm-button crm-button-primary" disabled={busy || Boolean(job.current)}>Save reviewed facts</button>
            <button type="button" className="crm-button" disabled={busy} onClick={closeEditor}>Cancel</button></div>
        </fieldset></form> : null}
        <button type="button" className="crm-button" disabled={busy || Boolean(editing) || !workspace.entries.length} onClick={() => {
          setBusy(true); setError('');
          void workspaceFetch<{ markets: OpportunityMarket[] }>('/api/workers-comp', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(target) }).then((result) => setMarkets(result.markets))
            .catch((failure: unknown) => setError(failureMessage(failure))).finally(() => setBusy(false));
        }}>Compare with workers&apos; comp guides</button>
        {markets ? <div className="space-y-2" aria-label="Private workers' comp guide comparison">
          {!markets.length ? <p>No active workers&apos; comp guide matches this coverage. Add a guide in Carrier Appetite.</p> : null}
          {markets.map((market) => <details key={market.document_id}>
            <summary className="cursor-pointer font-semibold">{market.carrier} · {market.status === 'excluded' ? 'Not a fit' : 'Review details'}</summary>
            <p className="mt-2">{market.recommendation}</p>
            <ul className="mt-2 list-disc pl-4">{market.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {market.rules.map((rule) => <p key={rule.id} className="mt-2 text-xs">{rule.criterion}: {rule.result.replace(/_/g, ' ')} · Guide page {rule.page}</p>)}
          </details>)}
          <p className="text-xs text-cui-muted">Compared on this record only. Private payroll, loss and mod details are not added to marketing or shared search results.</p>
        </div> : null}
      </> : null}
    </>}
  </section>;
}
