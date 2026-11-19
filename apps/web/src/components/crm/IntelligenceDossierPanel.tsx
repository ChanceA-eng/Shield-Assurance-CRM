'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_DOSSIER_FINDINGS, readRenewalEvidence, renewalEvidenceLabel,
  type IntelligenceDossier, type DossierFindings, type RecordTarget } from '@crm/shared';
import { dossierBriefing } from '../../lib/dossier';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { isRecord } from '../../lib/workspace-validation';
import dynamic from 'next/dynamic';
import BusinessResearchPanel from './BusinessResearchPanel';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

const OpportunityWorkspace = dynamic(() => import('./OpportunityWorkspace'), {
  loading: () => <p role="status" className="text-sm">Loading market fit and actions...</p>,
});

const fields: Array<[keyof DossierFindings, string]> = [
  ['business_identity', 'Confirmed business / branch identity'],
  ['decision_maker', 'Verified decision-maker and buying authority'],
  ['buying_process', 'Confirmed buying process'], ['stated_priorities', 'Prospect-stated priorities'],
  ['required_lines', 'Required coverage lines'], ['renewal_line', 'Confirmed renewal line'],
  ['renewal_date', 'Confirmed renewal date'], ['next_step', 'Agreed next step'],
];
const control = 'crm-input mt-1 block';

export default function IntelligenceDossierPanel({ target }: { target: RecordTarget }): JSX.Element {
  const [dossier, setDossier] = useState<IntelligenceDossier | null>(null);
  const [findings, setFindings] = useState<DossierFindings>({ ...EMPTY_DOSSIER_FINDINGS });
  const [reference, setReference] = useState(''), [date, setDate] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [page, setPage] = useState(0), [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false), [actionsLoaded, setActionsLoaded] = useState(false);
  useUnsavedChanges(editing);
  const generation = useRef(0), request = useRef<{ payload: string; id: string } | null>(null);
  const editBase = useRef<{ scope: string; version: number } | null>(null);
  const load = useCallback(async (reset: boolean, historyPage: number) => {
    const version = ++generation.current;
    const data = await workspaceFetch<IntelligenceDossier>(`/api/intelligence/dossier?type=${target.type}&id=${target.id}&page=${historyPage}`);
    if (version !== generation.current) return;
    setDossier(data);
    if (reset) {
      editBase.current = { scope: data.scope_key, version: data.version };
      setFindings({ ...EMPTY_DOSSIER_FINDINGS, ...data.findings }); setEditing(false); setReference(''); setDate('');
    }
  }, [target.id, target.type]);
  useEffect(() => {
    setDossier(null); setError(''); setPage(0); request.current = null;
    const expanded = new URLSearchParams(window.location.search).get('intelligence') === '1';
    setActionsOpen(expanded); setActionsLoaded(expanded);
    void load(true, 0).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Dossier could not be loaded.'));
    return () => { generation.current++; };
  }, [load]);
  const briefing = dossier ? dossierBriefing(dossier) : null;
  return <section aria-label="Business intelligence" className="mt-4 space-y-3 rounded border border-cui-border p-3">
    <h3 className="text-sm font-semibold">Business intelligence</h3>
    <BusinessResearchPanel key={`${target.type}:${target.id}`} target={target} />
    <details open={actionsOpen} onToggle={(event) => {
      setActionsOpen(event.currentTarget.open);
      if (event.currentTarget.open) setActionsLoaded(true);
    }}>
      <summary className="cursor-pointer text-sm font-semibold text-cui-primary">Market fit and next actions</summary>
      <div className="mt-3">{actionsLoaded ? <OpportunityWorkspace key={`${target.type}:${target.id}`} target={target} /> : null}</div>
    </details>
    {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-green-800">{notice}</p> : null}
    <button disabled={busy} className="text-xs text-cui-primary underline" onClick={() => {
      if (editing && !window.confirm('Discard unsaved dossier changes and load the latest findings?')) return;
      setError(''); void load(true, page).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Dossier could not be loaded.'));
    }}>Reload dossier</button>
    {dossier ? <>
      <p className="text-xs text-cui-muted">{dossier.record_name} · findings revision {dossier.version}. Linked leads use the account dossier. Source observations remain unverified unless separately confirmed.</p>
      <details><summary className="cursor-pointer text-sm font-semibold">Confirm findings</summary>
        <form className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const input = { type: target.type, id: target.id, scope_key: editBase.current?.scope,
            expected_version: editBase.current?.version, findings, reference, source_as_of: date };
          const payload = JSON.stringify(input);
          if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
          setBusy(true); setError(''); setNotice('');
          void workspaceFetch('/api/intelligence/dossier', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, request_id: request.current.id }) })
            .then(async () => { await load(true, 0); request.current = null; setPage(0); setNotice('Findings confirmed with source reference. No message or consent was created.'); })
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Findings could not be saved.'))
            .finally(() => setBusy(false));
        }}>
          <fieldset disabled={busy} className="space-y-3">
            {fields.map(([field, label]) => <label className="block text-xs" key={field}>{label}
              {field === 'renewal_date' ? <input type="date" className={control} value={findings[field]} onChange={(event) => { setFindings((current) => ({ ...current, [field]: event.target.value })); setEditing(true); }} />
                : <textarea rows={2} maxLength={1000} className={control} value={findings[field]} onChange={(event) => { setFindings((current) => ({ ...current, [field]: event.target.value })); setEditing(true); }} />}
            </label>)}
            <label className="block text-xs">Evidence reference (conversation, document or verification method)<textarea required maxLength={1000} className={control} value={reference} onChange={(event) => { setReference(event.target.value); setEditing(true); }} /></label>
            <label className="block text-xs">Evidence confirmed on (UTC)<input type="date" required className={control} value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => { setDate(event.target.value); setEditing(true); }} /></label>
            <p className="text-xs text-cui-muted">Clear a field to retract its current finding. Previous versions remain in history.</p>
            <button className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white">Save confirmed findings</button>
          </fieldset>
        </form>
      </details>
      <div className="space-y-1 text-xs">
        <h4 className="font-semibold">Current confirmed findings</h4>
        {dossier.current_confirmation ? <p className="break-words text-cui-muted">Evidence: {dossier.current_confirmation.reference} · confirmed on {dossier.current_confirmation.source_as_of} · actor {dossier.current_confirmation.actor_id}. Reconfirm if circumstances changed.</p> : null}
        {fields.filter(([field]) => dossier.findings[field]).map(([field, label]) => <p key={field} className="whitespace-pre-wrap break-words"><span className="font-semibold">{label}:</span> {dossier.findings[field]}</p>)}
        {!Object.values(dossier.findings).some(Boolean) ? <p className="text-cui-muted">No agent-confirmed findings yet.</p> : null}
      </div>
      {briefing ? <details><summary className="cursor-pointer text-sm font-semibold">Internal opportunity briefing</summary>
        <div className="mt-2 space-y-2 text-xs">
          <p>{briefing.opening}</p>
          <h4 className="font-semibold">Missing answers</h4><ul className="list-inside list-disc">{briefing.missing.map((item) => <li key={item}>{item}</li>)}</ul>
          <h4 className="font-semibold">Discovery questions</h4><ul className="list-inside list-disc">{briefing.questions.map((item) => <li key={item}>{item}</li>)}</ul>
          {briefing.signals.map((signal) => <div key={signal.detail} className="rounded bg-cui-light p-2"><p className="font-semibold">{signal.title} · needs verification</p><p>{signal.detail}</p><p className="break-all text-cui-muted">Evidence: {signal.evidence_ids.join(', ')}</p></div>)}
        </div>
      </details> : null}
      <details><summary className="cursor-pointer text-sm font-semibold">Evidence and confirmation history</summary>
        <div className="mt-2 space-y-3 text-xs">
          {dossier.confirmations.map((confirmation) => <div key={confirmation.id} className="rounded border border-cui-border p-2">
            <p className="font-semibold">Agent confirmation · revision {confirmation.version}</p>
            {confirmation.scope_key !== dossier.scope_key ? <p className="text-cui-muted">Historical lead findings before account linking; not merged into current account findings.</p> : null}
            <p className="whitespace-pre-wrap break-words">{confirmation.reference}</p>
            <p>Evidence confirmed on {confirmation.source_as_of} · captured {new Date(confirmation.observed_at).toLocaleString()}</p>
            <p className="break-all text-cui-muted">Actor {confirmation.actor_id} · evidence {confirmation.id}</p>
            {fields.filter(([field]) => confirmation.findings[field]).map(([field, label]) => <p key={field} className="break-words">{label}: {confirmation.findings[field]}</p>)}
          </div>)}
          {dossier.observations.map((observation) => {
            const snapshot = observation.snapshot;
            const units = typeof snapshot.power_units === 'number' ? snapshot.power_units : null;
            const company = isRecord(snapshot.company) ? snapshot.company : {};
            return <div key={observation.id} className="rounded border border-cui-border p-2">
              <p className="font-semibold">{observation.source} · source observation</p>
              <p>Captured {new Date(observation.observed_at).toLocaleString()} · source reporting date {observation.source_as_of || (typeof snapshot.mcs150_date === 'string' ? snapshot.mcs150_date : 'unknown')}</p>
              <p className="break-all text-cui-muted">Evidence {observation.id} · match: {observation.match_method} (not identity confirmation)</p>
              {typeof company.name === 'string' ? <p>Reported business: {company.name}</p> : null}
              {typeof snapshot.dot_number === 'string' ? <p>Reported DOT: {snapshot.dot_number}</p> : null}
              {units !== null ? <p>Reported power units: {units}</p> : null}
              {typeof snapshot.total_inspections === 'number' ? <p>Retrieved OSHA inspection matches: {snapshot.total_inspections} (not a complete history)</p> : null}
              {readRenewalEvidence(snapshot.renewals).map((renewal, index) => <p key={index}>{renewal.type}: {renewalEvidenceLabel(renewal)}{renewal.carrier ? ` · reported ${renewal.carrier}` : ''}</p>)}
            </div>;
          })}
          {!dossier.observations_total && !dossier.history_total ? <p>No persisted source history. Legacy profile data is not retrospectively labeled verified.</p> : null}
          <div className="flex flex-wrap gap-3">
            <button disabled={busy || page === 0} className="text-cui-primary" onClick={() => { setPage((current) => current - 1); void load(false, page - 1).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'History could not be loaded.')); }}>Previous history</button>
            <span>History page {page + 1}</span>
            <button disabled={busy || (page + 1) * 25 >= Math.max(dossier.observations_total, dossier.history_total)} className="text-cui-primary" onClick={() => { setPage((current) => current + 1); void load(false, page + 1).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'History could not be loaded.')); }}>Next history</button>
          </div>
        </div>
      </details>
    </> : null}
  </section>;
}
