'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OPPORTUNITY_STAGES, type OpportunityOperations as Operations, type RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { composerDraftClass } from './MessageComposer';

const control = 'crm-input mt-1';
export default function OpportunityOperations({ target }: { target: RecordTarget }): JSX.Element {
  const [data, setData] = useState<Operations | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [stage, setStage] = useState('qualified'), [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(''), [reason, setReason] = useState(''), [cost, setCost] = useState('0'), [premium, setPremium] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [kind, setKind] = useState('contact_role'), [value, setValue] = useState(''), [reference, setReference] = useState(''), [documentId, setDocumentId] = useState('');
  const [previous, setPrevious] = useState(''), [previousDate, setPreviousDate] = useState('');
  const [questions, setQuestions] = useState(''), [answerId, setAnswerId] = useState(''), [response, setResponse] = useState('');
  const [person, setPerson] = useState(''), [optIn, setOptIn] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const pending = useRef<{ key: string; id: string } | null>(null);
  const load = useCallback(async () => setData(await workspaceFetch<Operations>(`/api/intelligence/operations?type=${target.type}&id=${target.id}`)), [target.id, target.type]);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Opportunity operations could not be loaded.')); }, [load]);
  const act = async (action: string, payload: object): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    const key = JSON.stringify([target, action, payload]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      await workspaceFetch('/api/intelligence/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, action, request_id: pending.current.id, ...(action === 'watch' ? payload : { payload }) }) });
      await load(); setNotice('Saved. No customer message was sent. Reload the opportunity before using updated evidence.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Opportunity action could not be completed.'); }
    finally { setBusy(false); }
  };
  const share = async (requestId: string, revoke: boolean): Promise<void> => {
    setBusy(true); setError(''); setShareLink('');
    try {
      const result = await workspaceFetch<{ path?: string }>('/api/intelligence/questionnaire', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, request_id: requestId, revoke }) });
      if (result.path) setShareLink(new URL(result.path, window.location.origin).href);
      setNotice(revoke ? 'All links for this request were withdrawn.' : 'Seven-day questionnaire link created. Share only with the intended business; no email was sent.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Questionnaire link could not be updated.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Opportunity evidence and outcomes" className="space-y-3 rounded border border-cui-border bg-white p-3">
    <h3 className="text-sm font-semibold">Evidence, follow-through and outcomes</h3>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {data ? <>
      <button type="button" disabled={busy} className={composerDraftClass} onClick={() => void act('watch', { enabled: !data.watch?.enabled })}>{data.watch?.enabled ? 'Stop watching this business' : 'Watch this business'}</button>
      {data.watch ? <p className="text-xs text-cui-muted">Last internal evaluation: {data.watch.last_evaluated_at ? new Date(data.watch.last_evaluated_at).toLocaleString() : 'Not run'}. {data.watch.error ?? ''}</p> : null}
      <details><summary className="cursor-pointer text-sm font-semibold">Record a business outcome</summary>
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void act('outcome', { stage, occurred_on: date, source, reason, cost: Number(cost), premium: premium ? Number(premium) : null, ...(supersedes ? { supersedes } : {}) }); }}>
          <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Correct an outcome (optional)<select className={control} value={supersedes} onChange={(event) => {
              setSupersedes(event.target.value);
              const old = data.outcomes.find((item) => item.id === event.target.value);
              if (old) { setStage(old.stage); setDate(old.occurred_on); setSource(old.source); setReason(old.reason); setCost(String(old.cost)); setPremium(old.premium === null ? '' : String(old.premium)); }
            }}><option value="">Record a new outcome</option>{data.outcomes.map((item) => <option key={item.id} value={item.id}>{item.occurred_on} · {item.stage} · {item.source}</option>)}</select></label>
            <label className="text-xs">Outcome<select className={control} value={stage} onChange={(event) => { setStage(event.target.value); setPremium(''); }}>{OPPORTUNITY_STAGES.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></label>
            <label className="text-xs">Occurred on<input className={control} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="text-xs">Acquisition source / campaign<input className={control} required maxLength={500} value={source} onChange={(event) => setSource(event.target.value)} /></label>
            <label className="text-xs">Incremental attributable cost ($)<input className={control} type="number" min={0} step=".01" required value={cost} onChange={(event) => setCost(event.target.value)} /></label>
            <label className="text-xs">Quoted / written premium only ($)<input className={control} type="number" min={0} step=".01" disabled={!['quote', 'bound'].includes(stage)} value={premium} onChange={(event) => setPremium(event.target.value)} /></label>
            <label className="text-xs">Reason / evidence<input className={control} maxLength={1000} required={['lost', 'declined'].includes(stage)} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <button className={composerDraftClass}>Record outcome</button>
          </fieldset>
        </form>
        <ul className="mt-2 space-y-1 text-xs">{data.outcomes.map((item) => <li key={item.id}>{item.occurred_on} · {item.stage.replace(/_/g, ' ')} · {item.source}{item.reason ? ` · ${item.reason}` : ''}</li>)}</ul>
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Add reviewed evidence / dated business change</summary>
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void act('evidence', { kind, value, reference, source_as_of: date, confirmed: true,
          ...(kind === 'document' ? { document_id: documentId } : {}), ...(['authority', 'location'].includes(kind) ? { previous_value: previous, previous_as_of: previousDate } : {}) }); }}>
          <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Evidence type<select className={control} value={kind} onChange={(event) => setKind(event.target.value)}>{[['contact_role', 'Verified decision-maker role'], ['authority', 'Operating-authority change'], ['location', 'Verified location change'], ['document', 'Private policy/document fact'], ['held_line', 'Confirmed held coverage line'], ['cross_sell', 'Prospect-confirmed additional line to review']].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-xs">Reviewed business fact<input className={control} required maxLength={1000} value={value} onChange={(event) => setValue(event.target.value)} /></label>
            <label className="text-xs">Source / identity verification reference<input className={control} required maxLength={1000} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
            <label className="text-xs">Source as of<input className={control} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            {kind === 'document' ? <label className="text-xs">Private account document<select className={control} required value={documentId} onChange={(event) => {
              setDocumentId(event.target.value);
              const file = data.documents.find((item) => item.id === event.target.value);
              if (file) { setReference(file.file_name); if (file.review_summary) setValue(file.review_summary); }
            }}><option value="">Select uploaded account file</option>{data.documents.map((file) => <option key={file.id} value={file.id}>{file.file_name}</option>)}</select></label> : null}
            {['authority', 'location'].includes(kind) ? <><label className="text-xs">Earlier value<input className={control} required maxLength={1000} value={previous} onChange={(event) => setPrevious(event.target.value)} /></label>
              <label className="text-xs">Earlier source date<input className={control} type="date" required value={previousDate} onChange={(event) => setPreviousDate(event.target.value)} /></label></> : null}
            <button className={composerDraftClass}>Confirm and save evidence</button>
          </fieldset>
        </form>
        <p className="mt-2 text-xs text-cui-muted">Business evidence only. Keep identity documents, financial details and private loss records in private account files.</p>
        <ul className="mt-2 space-y-1 text-xs">{data.evidence.map((item) => <li key={item.id}>{item.source_as_of} · {item.kind.replace(/_/g, ' ')} · {item.value}</li>)}</ul>
        <p className="mt-2 text-xs">Current recorded held lines: {data.held_lines.join(', ') || 'Unknown'}</p>
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Discovery questions and document requests</summary>
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void act('request', { questions }); }}>
          <label className="block text-xs">Questions / documents to request<textarea className={control} required maxLength={3000} value={questions} onChange={(event) => setQuestions(event.target.value)} /></label>
          <button disabled={busy} className={composerDraftClass}>Save request checklist</button>
        </form>
        <ul className="my-2 space-y-3 text-xs">{data.requests.map((item) => <li key={item.id}><p>{item.state}: {item.questions}{item.response ? ` — ${item.response}` : ''}</p>
          {item.state === 'responded' ? <p className="text-cui-muted">Prospect-submitted; identity and facts need agent review before use.</p> : null}
          <div className="mt-1 flex gap-3"><button disabled={busy} type="button" className="text-cui-primary underline" onClick={() => void share(item.id, false)}>Create 7-day questionnaire link</button>
            <button disabled={busy} type="button" className="text-cui-primary underline" onClick={() => void share(item.id, true)}>Withdraw questionnaire links</button></div>
        </li>)}</ul>
        {shareLink ? <label className="mb-3 block text-xs">Private questionnaire link (anyone with this link can respond)<input readOnly aria-label="Private questionnaire link" className={control} value={shareLink} onFocus={(event) => event.target.select()} /></label> : null}
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void act('answer', { request_id: answerId, response, reference, source_as_of: date }); }}>
          <label className="block text-xs">Request<select className={control} required value={answerId} onChange={(event) => setAnswerId(event.target.value)}><option value="">Select request</option>{data.requests.map((item) => <option key={item.id} value={item.id}>{item.questions.slice(0, 100)}</option>)}</select></label>
          <label className="block text-xs">Prospect-authorized business response<textarea className={control} required maxLength={3000} value={response} onChange={(event) => setResponse(event.target.value)} /></label>
          <label className="block text-xs">Response reference<input className={control} required value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="block text-xs">Response as of<input className={control} required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <button disabled={busy || !answerId} className={composerDraftClass}>Record response</button>
        </form>
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">Permissioned introduction review</summary>
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void act('relationship', { name: person, reference, opt_in: optIn }); }}>
          <label className="block text-xs">Business introduction contact<input className={control} required maxLength={120} value={person} onChange={(event) => setPerson(event.target.value)} /></label>
          <label className="block text-xs">Permitted shared-contact evidence<input className={control} required maxLength={1000} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />I opt in to this suggestion and verified permission to use this business relationship. No private mailbox mining.</label>
          <button disabled={busy || !optIn} className={composerDraftClass}>Save introduction suggestion</button>
        </form>
        {data.relationships.map((item) => <div key={item.id} className="mt-2 text-xs"><p>{item.name} · {item.state}</p><p>{item.reference}</p>
          {item.state === 'suggested' ? <div className="flex gap-3">{(['approved', 'dismissed'] as const).map((state) => <button key={state} disabled={busy} className="text-cui-primary underline" onClick={() => void act('relationship_review', { relationship_id: item.id, state })}>{state === 'approved' ? 'Approve introduction review' : 'Dismiss'}</button>)}</div> : null}
        </div>)}
        <p className="mt-2 text-xs text-cui-muted">Approval records an internal decision only. Every introduction still needs its own reviewed message and explicit send.</p>
      </details>
    </> : <p className="text-xs">{error ? 'Resolve the error before continuing.' : 'Loading operations...'}</p>}
  </section>;
}
