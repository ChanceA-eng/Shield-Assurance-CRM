'use client';

import { useEffect, useRef, useState } from 'react';
import { APPETITE_DECISIONS, CARRIER_ACCESS, carrierAppetiteAvailability, type CarrierAppetiteDocument, type CarrierAppetiteValues, type CarrierAppetiteRule } from '@crm/shared';
import SectionLayout from '../../../components/crm/SectionLayout';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { readCarrierAppetite } from '../../../lib/browser-carrier-appetite';
import { parseCarrierAppetite } from '../../../lib/carrier-appetite';
import { putToSignedUrl } from '../../../lib/account-document-client';
import AppetiteComparison from '../../../components/crm/AppetiteComparison';
import { useUnsavedChanges } from '../../../context/WorkspaceNavigationContext';

const empty = (): CarrierAppetiteValues => ({ carrier: '', title: '', line: '', states: '', effective_on: '', expires_on: '',
  access: 'unconfirmed', access_reference: '', rights_reference: '', rules: [] });
type Summary = Pick<CarrierAppetiteDocument, 'id' | 'revision' | 'state' | 'values' | 'file_name'>;
const input = 'w-full rounded border border-cui-border bg-white px-2 py-2 text-sm';
export default function CarrierAppetitePage(): JSX.Element {
  const [documents, setDocuments] = useState<Summary[]>([]);
  const [owner, setOwner] = useState(false);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [overlaps, setOverlaps] = useState<string[]>([]);
  const [current, setCurrent] = useState<CarrierAppetiteDocument | null>(null);
  const [values, setValues] = useState<CarrierAppetiteValues>(empty);
  const [pages, setPages] = useState<Array<{ page: number; text: string }>>([]);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiFailed, setAiFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [proposedRules, setProposedRules] = useState<CarrierAppetiteRule[]>([]);
  const [sourcePage, setSourcePage] = useState(1);
  const [manualExcerpt, setManualExcerpt] = useState('');
  const uploadId = useRef(crypto.randomUUID());
  const uploaded = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const sourceDetails = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fail = (failure: unknown): void => setError(failure instanceof Error ? failure.message : 'Carrier appetite could not be updated. Retry.');
  const load = async (target: number): Promise<void> => {
    const result = await workspaceFetch<{ documents: Summary[]; has_more: boolean; can_manage: boolean; overlapping_sources: string[] }>(`/api/carrier-appetite?page=${target}`);
    setDocuments(result.documents); setMore(result.has_more); setOwner(result.can_manage);
    setOverlaps(result.overlapping_sources);
  };
  useEffect(() => { void load(page).catch(fail); }, [page]);
  const update = (patch: Partial<CarrierAppetiteValues>): void => { setValues((old) => ({ ...old, ...patch })); setDirty(true); };
  const discard = (): boolean => !dirty || window.confirm('Discard the unsaved carrier document review?');
  const read = async (selected: File, force = false): Promise<void> => {
    if (!discard()) return;
    setBusy(true); setError(''); setAiFailed(false); setNotice('Reading carrier document on this device...');
    const active = new AbortController(); controller.current = active;
    try {
      const result = await readCarrierAppetite(selected, active.signal, setNotice, force);
      setFile(selected); setCurrent(null); setPages(result.pages); setSourcePage(1); setManualExcerpt('');
      setValues({ ...empty(), title: selected.name, ...result.metadata, rules: result.rules });
      setProposedRules(result.rules);
      setDirty(true); uploaded.current = false; uploadId.current = crypto.randomUUID();
      setNotice(result.rules.length ? `${result.rules.length} entries found. Save and use the guide; editing individual entries is optional.` : 'No clear rules found. You can still save the guide for reference. It will not produce an automatic carrier match yet.');
    } catch (failure) { fail(failure); setNotice(''); }
    finally { controller.current = null; setBusy(false); }
  };
  const open = async (id: string): Promise<void> => {
    if (!discard()) return;
    setBusy(true); setError(''); setAiFailed(false);
    try {
      const result = await workspaceFetch<{ document: CarrierAppetiteDocument }>(`/api/carrier-appetite?id=${id}`);
      setCurrent(result.document); setValues(result.document.values); setPages(result.document.pages);
      setFile(null); setDirty(false); setSourcePage(1); setManualExcerpt(''); setNotice('');
      setProposedRules([]);
    } catch (failure) { fail(failure); } finally { setBusy(false); }
  };
  const reRead = async (): Promise<void> => {
    if (!discard()) return;
    setBusy(true); setError(''); setAiFailed(false); setNotice('Reading the original guide...');
    const active = new AbortController(); controller.current = active;
    try {
      let original = file;
      if (!original && current) {
        const response = await fetch(`/api/carrier-appetite?id=${current.id}&download=1`, { signal: active.signal });
        if (!response.ok) throw new Error('The saved guide could not be opened. Try again.');
        original = new File([await response.blob()], current.file_name);
      }
      if (!original) throw new Error('Choose a carrier guide first.');
      const result = await readCarrierAppetite(original, active.signal, setNotice);
      const rules = result.rules.filter((rule) => !rule.carrier || rule.carrier.toLowerCase() === values.carrier.toLowerCase());
      update(parseCarrierAppetite({ ...values, rules, unresolved_entries: [], interpretation: undefined }, pages));
      setNotice(`${rules.length} entries rebuilt from the original guide. Select Save and use guide to replace the old reading.`);
    } catch (failure) { fail(failure); setNotice(''); }
    finally { controller.current = null; setBusy(false); }
  };
  const change = async (action: 'save' | 'use' | 'withdraw', retryAI = false): Promise<void> => {
    setBusy(true); setError(''); setAiFailed(false); setNotice('');
    try {
      let reviewed = action === 'use' && !values.interpretation ? { ...values } : parseCarrierAppetite(values, pages);
      let repaired = reviewed.rules.length !== values.rules.length
        || reviewed.rules.some((rule, index) => {
          const previous = values.rules[index];
          return !previous || rule.id !== previous.id || rule.excerpt !== previous.excerpt
            || rule.decision !== previous.decision || rule.criterion !== previous.criterion;
        }) || (reviewed.unresolved_entries?.length ?? 0) !== (values.unresolved_entries?.length ?? 0);
      setValues(reviewed);
      if (!current && !file) throw new Error('Choose a carrier source document first.');
      if (!current && file && !uploaded.current) {
        const ticket = await workspaceFetch<{ signed_url?: string; content_type: string; already_uploaded?: boolean }>('/api/carrier-appetite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reserve', id: uploadId.current, revision: 0, file_name: file.name, file_size: file.size, content_type: file.type }),
        });
        if (!ticket.already_uploaded) {
          if (!ticket.signed_url) throw new Error('No private upload URL was returned.');
          const result = await putToSignedUrl(ticket.signed_url, file, file.name, ticket.content_type);
          if (!result.ok) throw new Error(result.message);
        }
        uploaded.current = true;
      }
      if (action === 'use' && !reviewed.interpretation) {
        setNotice('AI is reading the original guide. This reading is saved and reused for every business.');
        const result = await workspaceFetch<{ values: CarrierAppetiteValues }>('/api/carrier-appetite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'interpret', id: current?.id ?? uploadId.current, revision: current?.revision ?? 0, pages, retry: retryAI }),
        }).catch((failure: unknown) => { setAiFailed(true); throw failure; });
        reviewed = { ...result.values, title: reviewed.title, carrier: reviewed.carrier || result.values.carrier,
          access: reviewed.access, access_reference: reviewed.access_reference, rights_reference: reviewed.rights_reference,
          effective_on: reviewed.effective_on, expires_on: reviewed.expires_on };
        repaired = true; setValues(reviewed); setDirty(true);
      }
      const send = (id: string, revision: number, operation: string, data: object = {}): Promise<CarrierAppetiteDocument> =>
        workspaceFetch<CarrierAppetiteDocument>('/api/carrier-appetite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, revision, action: operation, ...data }),
        });
      let saved = current;
      if (action !== 'withdraw' && (dirty || repaired || !saved || action === 'use' && saved.state === 'withdrawn')) {
        saved = await send(saved?.id ?? uploadId.current, saved?.revision ?? 0, 'save', { pages, values: reviewed });
        setCurrent(saved); setValues(saved.values); setDirty(false);
      }
      if (!saved) throw new Error('Save the guide first.');
      if (action === 'use') saved = await send(saved.id, saved.revision, 'activate');
      if (action === 'withdraw') saved = await send(saved.id, saved.revision, 'withdraw');
      setCurrent(saved); setValues(saved.values); setDirty(false);
      setNotice(action === 'save' ? 'Draft saved.' : action === 'use' ? 'Guide ready for carrier matching. Unclear entries stay flagged without blocking the guide.' : 'Carrier guidance withdrawn.');
      await load(page);
    } catch (failure) { fail(failure); setNotice(''); } finally { setBusy(false); }
  };
  const readSavedGuides = async (): Promise<void> => {
    if (!discard()) return;
    setBusy(true); setError(''); setAiFailed(false); setNotice('Opening saved guides...');
    let completed = 0;
    try {
      const saved: Summary[] = [];
      for (let index = 0; ; index++) {
        const batch = await workspaceFetch<{ documents: Summary[]; has_more: boolean }>(`/api/carrier-appetite?page=${index}`);
        saved.push(...batch.documents.filter((entry) => entry.state !== 'withdrawn' && !entry.values.interpretation));
        if (!batch.has_more) break;
      }
      for (const [index, entry] of saved.entries()) {
        setNotice(`Reading guide ${index + 1} of ${saved.length} with AI. Completed readings are reused.`);
        const { document } = await workspaceFetch<{ document: CarrierAppetiteDocument }>(`/api/carrier-appetite?id=${entry.id}`);
        const { document: updated } = await workspaceFetch<{ document: CarrierAppetiteDocument }>('/api/carrier-appetite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'interpret_saved', id: document.id, revision: document.revision, retry: true }),
        });
        completed++;
        if (current?.id === updated.id) { setCurrent(null); setValues(empty()); setPages([]); setFile(null); setDirty(false); }
      }
      await load(page);
      setNotice(saved.length ? `${completed} guides read. Business profiles now reuse these criteria without another AI call.` : 'All saved guides already have an AI reading.');
    } catch (failure) {
      fail(failure); setNotice(`${completed} guides completed. Completed readings are saved; select Read saved guides with AI to continue.`);
      await load(page).catch(fail);
    } finally { setBusy(false); }
  };
  return <SectionLayout title="Carrier Appetite">
    {error ? <p role="alert" className="mb-3 rounded border border-cui-danger p-3 text-sm">{error}
      <button type="button" className="ml-2 underline" disabled={busy} onClick={() => {
        if (aiFailed) void change('use', true);
        else { setError(''); void load(page).catch(fail); }
      }}>{aiFailed ? 'Retry AI reading' : 'Retry'}</button></p> : null}
    {notice ? <p role="status" className="mb-3 text-sm">{notice}</p> : null}
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_3fr]">
      <section className="rounded border border-cui-border bg-white p-3">
        <h2 className="mb-3 font-semibold">Carrier documents</h2>
        {owner ? <button type="button" disabled={busy} onClick={() => void readSavedGuides()} className="mb-3 text-sm text-cui-primary underline">Read saved guides with AI</button> : null}
        {documents.map((document) => <button key={document.id} type="button" disabled={busy} onClick={() => void open(document.id)}
          className="mb-2 block w-full rounded border border-cui-border p-2 text-left text-sm">
          <strong className="block">{document.values.carrier}</strong>{document.values.title}
          <span className="block text-xs text-cui-muted">{carrierAppetiteAvailability(document)} · revision {document.revision}</span>
          <span className="block text-xs text-cui-muted">{document.values.line || 'Coverage not read yet'}</span>
          {overlaps.includes(document.id) ? <span className="block text-xs text-cui-danger">Overlapping coverage guides: check differences</span> : null}
        </button>)}
        {!documents.length ? <p className="text-sm text-cui-muted">No carrier documents on this page.</p> : null}
        <div className="mt-3 flex gap-3 text-xs">
          <button disabled={busy || page === 0} onClick={() => setPage((old) => old - 1)}>Previous</button>
          <button disabled={busy || !more} onClick={() => setPage((old) => old + 1)}>Next</button>
        </div>
      </section>
      <section className="min-w-0 rounded border border-cui-border bg-white p-4">
        {owner ? <div className="mb-4 space-y-2 border-b border-cui-border pb-3">
          <label className="block text-sm font-semibold">Upload carrier guide
            <input aria-label="Carrier appetite document" type="file" disabled={busy}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx" className="mt-2 block w-full text-sm"
              onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void read(selected); }} />
          </label>
          <p className="text-xs text-cui-muted">PDF, images, TXT, CSV or XLSX. Up to 25 MB.</p>
          {file?.type === 'application/pdf' ? <button type="button" disabled={busy} className="text-xs text-cui-primary" onClick={() => void read(file, true)}>Read as a scanned PDF</button> : null}
          {busy && controller.current ? <button type="button" className="ml-3 text-xs text-cui-primary" onClick={() => controller.current?.abort()}>Cancel reading</button> : null}
        </div> : null}
        {current && overlaps.includes(current.id) ? <p role="status" className="mb-3 text-sm text-cui-danger">Other guides cover this carrier's same coverage and territory. Check their differences; separate coverage guides are matched independently.</p> : null}
        {pages.length ? <fieldset disabled={busy || !owner} className="space-y-4">
          {new Set(proposedRules.flatMap((rule) => rule.carrier ? [rule.carrier] : [])).size > 1 ? <label className="block text-xs font-semibold">This guide contains multiple carriers. Review each separately.
            <select aria-label="Carrier from source" className={`${input} mt-1`} value={values.carrier} onChange={(event) => {
              const carrier = event.target.value;
              const rules = proposedRules.filter((rule) => !rule.carrier || rule.carrier.toLowerCase() === carrier.toLowerCase());
              if (current && file && carrier !== current.values.carrier) {
                if (!discard()) return;
                setCurrent(null); uploadId.current = crypto.randomUUID(); uploaded.current = false;
                setValues({ ...empty(), title: file.name, carrier, rules });
                setDirty(true);
                setNotice('Separate carrier review started. The previous carrier document is retained.');
              } else update({ carrier, rules });
            }}>
              <option value="">Select carrier from source</option>
              {[...new Set(proposedRules.flatMap((rule) => rule.carrier ? [rule.carrier] : []))].map((carrier) => <option key={carrier}>{carrier}</option>)}
            </select>
          </label> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {(['carrier', 'title', 'line', 'states'] as const).map((field) => <label key={field} className="text-xs font-semibold">
              {{ carrier: 'Carrier', title: 'Guide name', line: 'Coverage (optional)', states: 'States (optional)' }[field]}
              <input aria-label={field} className={`${input} mt-1`} type="text" value={values[field]} onChange={(event) => update({ [field]: event.target.value })} />
            </label>)}
            <label className="text-xs font-semibold">How do you place business with this carrier?
              <select aria-label="Agency carrier access" className={`${input} mt-1`} value={values.access} onChange={(event) => update({ access: event.target.value as CarrierAppetiteValues['access'] })}>
                {CARRIER_ACCESS.map((access) => <option key={access} value={access}>{{ unconfirmed: 'Choose a route', direct: 'Direct appointment', mga_wholesaler: 'Through an MGA or wholesaler', unavailable: 'Not a market we use' }[access]}</option>)}
              </select>
            </label>
          </div>
          <div className="space-y-2">
            <h2 className="font-semibold">Guide summary</h2>
            {values.interpretation ? <p className="text-sm">{values.interpretation.summary}</p> : <p className="text-sm">Select Save and use guide for a one-time AI reading. Future business searches reuse the saved criteria.</p>}
            <p className="text-sm">{values.rules.filter((rule) => rule.decision === 'preferred' || rule.decision === 'eligible').length} accepted or preferred · {values.rules.filter((rule) => rule.decision === 'excluded').length} excluded · {values.rules.filter((rule) => rule.decision === 'referral' || rule.decision === 'condition').length} conditions or referrals · {values.rules.filter((rule) => rule.decision === 'needs_review').length} unclear</p>
            <p className="text-xs text-cui-muted">Unclear entries are kept with the guide, not treated as approval. You do not need to answer them to save or use it.</p>
            {values.unresolved_entries?.length ? <p role="status" className="text-sm text-amber-800">{values.unresolved_entries.length} {values.unresolved_entries.length === 1 ? 'entry' : 'entries'} could not be read reliably. Your guide can still be saved; unclear entries will not be used to confirm a carrier match.</p> : null}
            {current ? <button type="button" className="text-sm text-cui-primary underline" onClick={() => void reRead()}>Re-read original guide</button> : null}
          </div>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm text-cui-primary">View or correct extracted entries (optional)</summary>
            {values.unresolved_entries?.map((entry, index) => <div key={index} className="rounded border border-amber-200 p-2 text-sm">
              <p>{entry.criterion}</p><p className="text-xs text-cui-muted">{entry.reason}</p>
            </div>)}
          {values.rules.map((rule, index) => <div key={rule.id} className="grid gap-2 rounded border border-cui-border p-2 sm:grid-cols-[1fr_150px_auto]">
            <label className="space-y-1 text-xs">Business type or requirement
              <textarea aria-label={`Rule ${index + 1}`} className={input} rows={2} maxLength={2200} value={rule.criterion}
                onChange={(event) => update({ rules: values.rules.map((item) => item.id === rule.id ? { ...item, criterion: event.target.value } : item) })} />
            </label>
            <div className="space-y-1">
              <label className="block text-xs">Extracted category
              <select aria-label={`Decision ${index + 1}`} className={input} value={rule.decision}
                onChange={(event) => update({ rules: values.rules.map((item) => item.id === rule.id ? { ...item, decision: event.target.value as typeof rule.decision } : item) })}>
                {APPETITE_DECISIONS.map((entry) => <option key={entry} value={entry}>{{ preferred: 'Preferred business', eligible: 'Will consider', excluded: 'Will not write', referral: 'Ask underwriter first', condition: 'Requirement to qualify', needs_review: 'Not clear in the guide' }[entry]}</option>)}
              </select>
              </label>
              <button type="button" className="text-xs text-cui-primary" onClick={() => {
                setSourcePage(rule.page); setManualExcerpt(rule.excerpt);
                if (sourceDetails.current) { sourceDetails.current.open = true; sourceDetails.current.scrollIntoView({ block: 'nearest' }); }
              }}>Source page {rule.page}</button>
            </div>
            <button type="button" className="text-xs text-cui-danger" onClick={() => update({ rules: values.rules.filter((item) => item.id !== rule.id) })}>Remove</button>
              <blockquote className="border-l-2 border-cui-border pl-2 text-xs text-cui-muted sm:col-span-3">From page {rule.page}: {rule.excerpt}</blockquote>
            <AppetiteComparison value={rule.predicate} onChange={(predicate) => update({ rules: values.rules.map((item) => {
              if (item.id !== rule.id) return item;
              const { predicate: previous, ...rest } = item;
              return predicate ? { ...rest, predicate } : rest;
            }) })} />
          </div>)}
          {owner ? <details ref={sourceDetails} className="text-sm">
            <summary className="cursor-pointer text-cui-primary">Source text / add a missed rule</summary>
            <label className="mt-2 block">Page
              <select aria-label="Source page" value={sourcePage} className={input} onChange={(event) => { setSourcePage(Number(event.target.value)); setManualExcerpt(''); }}>
                {pages.map((item) => <option key={item.page} value={item.page}>{item.page}</option>)}
              </select>
            </label>
            <pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-cui-light p-2 text-xs">{pages.find((item) => item.page === sourcePage)?.text}</pre>
            <textarea aria-label="Exact source excerpt" className={input} value={manualExcerpt} onChange={(event) => setManualExcerpt(event.target.value)} placeholder="Copy an exact excerpt from this page" />
            <button type="button" className="mt-2 text-cui-primary" onClick={() => {
              const excerpt = manualExcerpt.trim();
              if (!excerpt || !pages.some((item) => item.page === sourcePage && item.text.includes(excerpt))) { setError('Copy an exact excerpt from the selected source page.'); return; }
              update({ rules: [...values.rules, { id: crypto.randomUUID(), criterion: excerpt, decision: 'needs_review', page: sourcePage, excerpt }] });
              setManualExcerpt('');
            }}>Add rule for review</button>
          </details> : null}
          </details>
          <details className="space-y-2 text-sm">
            <summary className="cursor-pointer text-cui-primary">Guide dates (only if printed in the guide)</summary>
            <p className="text-xs text-cui-muted">Leave these blank for an undated appetite guide.</p>
            {(['effective_on', 'expires_on'] as const).map((field) => <label key={field} className="block">
              {field === 'effective_on' ? 'Guide starts on (optional)' : 'Guide ends on (optional)'}
              <input aria-label={field} type="date" className={input} value={values[field]} onChange={(event) => update({ [field]: event.target.value })} />
            </label>)}
          </details>
          {owner ? <div className="space-y-3 border-t border-cui-border pt-3">
            <button type="button" disabled={!dirty && current?.state === 'active'} onClick={() => void change('use')} className="rounded bg-cui-primary px-3 py-2 text-sm text-white disabled:opacity-50">{current?.state === 'draft' && !dirty ? 'Use this guide' : 'Save and use guide'}</button>
            <button type="button" disabled={!dirty} onClick={() => void change('save')} className="rounded bg-cui-primary px-3 py-2 text-sm text-white disabled:opacity-50">Save draft</button>
            {current && current.state !== 'withdrawn' ? <button type="button" disabled={dirty} className="ml-3 text-sm text-cui-danger" onClick={() => {
              if (window.confirm('Withdraw this document from active carrier guidance? History and the private source will be retained.')) void change('withdraw');
            }}>Withdraw</button> : null}
          </div> : null}
        </fieldset> : <p className="text-sm text-cui-muted">Select a document to review. Each carrier keeps its own source-backed rules.</p>}
        {current ? <button type="button" disabled={busy} className="mt-3 text-sm text-cui-primary" onClick={() => {
          void fetch(`/api/carrier-appetite?id=${current.id}&download=1`).then(async (response) => {
            if (!response.ok) throw new Error('Private carrier source could not be downloaded.');
            const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
            link.href = url; link.download = current.file_name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }).catch(fail);
        }}>Download private source</button> : null}
        {current && dirty ? <button type="button" disabled={busy} className="ml-3 text-sm text-cui-primary" onClick={() => void open(current.id)}>Reload saved version</button> : null}
      </section>
    </div>
  </SectionLayout>;
}
