'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../../components/crm/SectionLayout';
import RecordPicker from '../../../components/crm/RecordPicker';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import type { PolicyKnowledgeCandidate } from '../../../lib/policy-knowledge';
import { useUnsavedChanges } from '../../../context/WorkspaceNavigationContext';

const fields = {
  carrier: 'Carrier', form_number: 'Form number', edition: 'Form edition',
  jurisdiction: 'Jurisdiction', line_of_business: 'Line of business',
} as const;
const empty = { account_id: '', carrier: '', form_number: '', edition: '', jurisdiction: '', line_of_business: '', wording: '' };
export default function PolicyKnowledgeReviewPage(): JSX.Element {
  const [values, setValues] = useState(empty);
  useUnsavedChanges(Object.values(values).some(Boolean));
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const submissionId = useRef<string | null>(null);
  const [candidates, setCandidates] = useState<PolicyKnowledgeCandidate[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [owner, setOwner] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rights, setRights] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [reviewRights, setReviewRights] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    const result = await workspaceFetch<{ candidates: PolicyKnowledgeCandidate[]; can_review: boolean; has_more: boolean }>('/api/policy-knowledge');
    setCandidates(result.candidates); setOwner(result.can_review);
    setNextPage(1); setHasMore(result.has_more); setLoaded(true);
    setReviewed(null); setReviewRights(null);
  }, []);
  useEffect(() => { void reload().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Could not load policy review.')); }, [reload]);
  const reset = (): void => { setValues(empty); setEditing(null); setPrivacy(false); setRights(false); submissionId.current = null; };
  const edit = (candidate: PolicyKnowledgeCandidate): void => {
    if ((editing || Object.values(values).some(Boolean)) && !window.confirm('Replace your unsaved wording edits?')) return;
    setValues({ account_id: candidate.account_id, carrier: candidate.carrier, form_number: candidate.form_number,
      edition: candidate.edition, jurisdiction: candidate.jurisdiction, line_of_business: candidate.line_of_business, wording: candidate.wording });
    setEditing({ id: candidate.id, revision: candidate.revision }); setPrivacy(false); setRights(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const act = async (candidate: PolicyKnowledgeCandidate, action: 'approve' | 'reject' | 'publish' | 'withdraw'): Promise<void> => {
    if (busy) return;
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} this exact wording revision?${action === 'withdraw' ? ' Its Rashi text, insights and embeddings will be removed.' : ''}`)) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await workspaceFetch('/api/policy-knowledge', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: candidate.id, revision: candidate.revision, action,
          privacy_confirmed: reviewed === `${candidate.id}:${candidate.revision}`,
          rights_confirmed: reviewRights === `${candidate.id}:${candidate.revision}` }),
      });
      setStatus(action === 'publish' ? 'Approved wording published to Rashi.' : action === 'withdraw' ? 'Wording withdrawn from Rashi.' : 'Review saved.');
      await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Review failed. Reload before retrying.'); }
    finally { setBusy(false); }
  };
  return <SectionLayout title="Policy wording review">
    <div className="max-w-5xl space-y-4">
      <Link href="/rashi/knowledge" className="text-sm font-semibold text-cui-primary">Back to Knowledge Manager</Link>
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {status ? <p role="status" className="text-sm text-cui-text">{status}</p> : null}
      <Card><CardHeader>{editing ? 'Edit proposed wording' : 'Propose reusable wording'}</CardHeader><CardBody>
        <p className="mb-3 text-xs text-cui-muted">Enter only reusable policy language you have permission to store and reuse. No originals, private links, customer names, contacts, addresses, policy numbers, VINs or premiums. An owner must approve the exact revision before it reaches Rashi.</p>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true); setError(''); setStatus('');
          void (async () => {
            try {
              submissionId.current ??= crypto.randomUUID();
              await workspaceFetch('/api/policy-knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...values, id: editing?.id ?? submissionId.current, revision: editing?.revision ?? 0,
                  privacy_confirmed: privacy, rights_confirmed: rights }) });
              reset(); setStatus('Submitted for owner review. Nothing was indexed or sent to external AI.');
              await reload();
            } catch (failure) { setError(failure instanceof Error ? failure.message : 'Submission failed. Your edits are preserved.'); }
            finally { setBusy(false); }
          })();
        }}>
          <fieldset disabled={busy || !loaded} className="space-y-3">
            <label className="block text-xs font-semibold">Private source account (never included in Rashi)</label>
            <RecordPicker type="client" value={values.account_id} onChange={(id) => { setValues((previous) => ({ ...previous, account_id: id })); setPrivacy(false); setRights(false); }} />
            <div className="grid gap-3 md:grid-cols-2">{(Object.keys(fields) as Array<keyof typeof fields>).map((key) => <label key={key} className="block text-xs font-semibold">
              {fields[key]}<input required maxLength={key === 'carrier' ? 150 : 100} value={values[key]}
                onChange={(event) => { setValues((previous) => ({ ...previous, [key]: event.target.value })); setPrivacy(false); setRights(false); }}
                className="mt-1 w-full rounded border border-cui-border px-3 py-2 text-sm" />
            </label>)}</div>
            <label className="block text-xs font-semibold">De-identified wording
              <textarea required minLength={40} maxLength={6000} rows={7} value={values.wording}
                onChange={(event) => { setValues((previous) => ({ ...previous, wording: event.target.value })); setPrivacy(false); setRights(false); }}
                className="mt-1 w-full rounded border border-cui-border px-3 py-2 text-sm" />
            </label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} />I removed all identifying and account-specific information from this excerpt and its metadata.</label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={rights} onChange={(event) => setRights(event.target.checked)} />I verified permission to store and reuse this wording, beyond permission to retain the client's policy.</label>
            <button type="submit" className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white">{busy ? 'Saving...' : 'Submit for owner review'}</button>
            {editing ? <button type="button" onClick={reset} className="ml-3 text-sm text-cui-muted">Cancel editing</button> : null}
          </fieldset>
        </form>
      </CardBody></Card>
      <Card><CardHeader>{owner ? 'Owner review queue' : 'Your submissions'}</CardHeader><CardBody>
        {!candidates.length ? <p className="text-sm text-cui-muted">{loaded ? 'No proposed wording.' : error ? 'Review is unavailable. Resolve the error above, then reload.' : 'Loading submissions...'}</p> : candidates.map((candidate) => {
          const revisionKey = `${candidate.id}:${candidate.revision}`;
          return <article key={candidate.id} className="mb-3 rounded border border-cui-border p-3">
            <h3 className="text-sm font-semibold">{candidate.carrier} / {candidate.form_number} / {candidate.edition}</h3>
            <p className="my-1 text-xs text-cui-muted">{candidate.jurisdiction} · {candidate.line_of_business} · Revision {candidate.revision} · {candidate.state}</p>
            <Link href={`/clients/${candidate.account_id}`} className="text-xs font-semibold text-cui-primary">Review private source account</Link>
            <p className="mb-3 whitespace-pre-wrap break-words text-sm">{candidate.wording}</p>
            <fieldset disabled={busy} className="space-y-2">
              {owner && ['submitted', 'approved'].includes(candidate.state) ? <>
                <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed === revisionKey} onChange={(event) => setReviewed(event.target.checked ? revisionKey : null)} />I inspected this exact revision and metadata and confirmed no identifying information remains.</label>
                <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewRights === revisionKey} onChange={(event) => setReviewRights(event.target.checked ? revisionKey : null)} />I verified permission to reuse and index this wording.</label>
              </> : null}
              <div className="flex flex-wrap gap-3 text-xs font-semibold text-cui-primary">
                {!['published', 'withdrawn'].includes(candidate.state) ? <button type="button" onClick={() => edit(candidate)}>Edit and resubmit</button> : null}
                {owner && candidate.state === 'submitted' ? <>
                  <button type="button" disabled={reviewed !== revisionKey || reviewRights !== revisionKey} className="disabled:opacity-40" onClick={() => void act(candidate, 'approve')}>Approve revision</button>
                  <button type="button" onClick={() => void act(candidate, 'reject')}>Reject</button>
                </> : null}
                {owner && candidate.state === 'approved' ? <button type="button" disabled={reviewed !== revisionKey || reviewRights !== revisionKey} className="disabled:opacity-40" onClick={() => void act(candidate, 'publish')}>Publish approved wording</button> : null}
                {owner && ['approved', 'published'].includes(candidate.state) ? <button type="button" onClick={() => void act(candidate, 'withdraw')}>Withdraw</button> : null}
              </div>
            </fieldset>
          </article>;
        })}
        {hasMore ? <button type="button" disabled={busy} className="text-sm font-semibold text-cui-primary disabled:opacity-40" onClick={() => {
          setBusy(true); setError('');
          void workspaceFetch<{ candidates: PolicyKnowledgeCandidate[]; has_more: boolean }>(`/api/policy-knowledge?page=${nextPage}`)
            .then((result) => {
              setCandidates((previous) => [...previous, ...result.candidates.filter((candidate) => !previous.some((row) => row.id === candidate.id))]);
              setNextPage((previous) => previous + 1); setHasMore(result.has_more);
            }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Older submissions could not be loaded. Retry.'))
            .finally(() => setBusy(false));
        }}>Load older submissions</button> : null}
      </CardBody></Card>
    </div>
  </SectionLayout>;
}
