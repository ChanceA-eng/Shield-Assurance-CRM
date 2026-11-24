'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BUSINESS_FIELDS, NUMERIC_BUSINESS_FIELDS, type OpportunityWorkspace as Workspace, type OpportunityProfile, type OpportunityDraft, type RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import MessageComposer, { composerDraftClass, composerSendClass } from './MessageComposer';
import AgentSenderBadge from './AgentSenderBadge';
import type { EmailProviderChoice } from './EmailProviderControl';
import OpportunityOperations from './OpportunityOperations';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

type Data = Workspace & { draft: OpportunityDraft | null; agents: Array<{ user_id: string; email: string }> };
const control = 'crm-input mt-1';
export default function OpportunityWorkspace({ target }: { target: RecordTarget }): JSX.Element {
  const [data, setData] = useState<Data | null>(null);
  const [profile, setProfile] = useState<OpportunityProfile | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<OpportunityDraft | null>(null);
  const [subject, setSubject] = useState(''), [body, setBody] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false), [assignee, setAssignee] = useState(''), [due, setDue] = useState('');
  const [provider, setProvider] = useState<EmailProviderChoice>('default');
  const [aiAllowed, setAiAllowed] = useState(false);
  const [useConversations, setUseConversations] = useState(false);
  const [citations, setCitations] = useState<string[]>([]);
  const [sendAttempted, setSendAttempted] = useState(false);
  const generation = useRef(0), draftId = useRef(crypto.randomUUID());
  const taskRequest = useRef<{ key: string; id: string } | null>(null);
  const draftDirty = subject !== (draft?.subject ?? '') || body !== (draft?.body ?? '');
  useUnsavedChanges(dirty || draftDirty);
  const fail = (failure: unknown): void => setError(failure instanceof Error ? failure.message : 'Opportunity action could not be completed.');
  const load = useCallback(async () => {
    const version = ++generation.current;
    const result = await workspaceFetch<Data>(`/api/intelligence/opportunities?type=${target.type}&id=${target.id}`);
    if (version !== generation.current) return;
    setData(result); setProfile(result.profile.profile); setDirty(false); setDraft(result.draft);
    setSubject(result.draft?.subject ?? ''); setBody(result.draft?.body ?? ''); setReviewed(false);
    setSendAttempted(false); setCitations([]); setAiAllowed(false); setUseConversations(false);
    draftId.current = result.draft?.id ?? crypto.randomUUID();
    setAssignee((old) => old || result.agents[0]?.user_id || '');
  }, [target.id, target.type]);
  useEffect(() => {
    setData(null); setError(''); setNotice('');
    void load().catch(fail);
    return () => { generation.current++; };
  }, [load]);
  const change = (patch: Partial<OpportunityProfile>): void => { setProfile((old) => old ? { ...old, ...patch } : old); setDirty(true); setReviewed(false); };
  const post = <T,>(input: object): Promise<T> => workspaceFetch<T>('/api/intelligence/opportunities', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: target.type, id: target.id, evidence_token: data?.evidence_token, ...input }),
  });
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { fail(failure); } finally { setBusy(false); }
  };
  const stale = !!draft && draft.evidence_token !== data?.evidence_token;
  const locked = !!draft && ['dispatching', 'sent', 'uncertain'].includes(draft.state);
  return <section aria-label="Market fit and actions" className="space-y-4">
    {error ? <p role="alert" className="rounded border border-cui-danger p-3 text-sm">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <button disabled={busy} className="text-sm text-cui-primary underline" onClick={() => {
      if ((dirty || draftDirty) && !window.confirm('Discard unsaved changes and reload this opportunity?')) return;
      void run(load);
    }}>Reload opportunity</button>
    {!data || !profile ? <p className="text-sm text-cui-muted">{error ? 'Resolve the error above, then reload.' : 'Loading reviewed business evidence...'}</p> : <>
      <header className="rounded border border-cui-border bg-white p-3">
        <h2 className="font-semibold">{data.record_name}</h2>
        <p className="text-sm">{data.assessment.status.replace(/_/g, ' ')} · priority {data.assessment.score.total}/100</p>
        {data.target_status ? <p className="text-xs text-cui-muted">Agency targeting: {data.target_status.replace(/_/g, ' ')}</p> : null}
        <p className="mt-1 text-sm">{data.assessment.next_step}</p>
        <details className="mt-2 text-xs"><summary className="cursor-pointer text-cui-primary">Why this priority?</summary>
          <ul className="mt-1 list-inside list-disc">{data.assessment.score.explanations.map((item) => <li key={item}>{item}</li>)}</ul>
        </details>
      </header>
      <details className="rounded border border-cui-border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">Reviewed business matching facts · revision {data.profile.revision}</summary>
        <form className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (draftDirty && !window.confirm('Saving business facts reloads this opportunity. Discard unsaved message edits?')) return;
          void run(async () => {
            await post({ action: 'profile', scope_key: data.profile.scope_key, revision: data.profile.revision, profile });
            await load(); setNotice('Business facts saved. Existing drafts must be re-reviewed; no carrier rules or consent records were changed.');
          });
        }}>
          <fieldset disabled={busy} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BUSINESS_FIELDS.map((field) => <label key={field} className="text-xs font-semibold">{field.replace(/_/g, ' ')}
                {['has_delivery', 'has_prior_losses'].includes(field) ? <select aria-label={`Business ${field}`} className={control} value={profile.facts[field] ?? ''}
                  onChange={(event) => change({ facts: { ...profile.facts, [field]: event.target.value } })}>
                  <option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
                </select> : <input aria-label={`Business ${field}`} className={control} maxLength={200} value={profile.facts[field] ?? ''}
                  type={NUMERIC_BUSINESS_FIELDS.some((key) => key === field) ? 'number' : 'text'} min={0} step="any"
                  onChange={(event) => change({ facts: { ...profile.facts, [field]: event.target.value } })} />}
              </label>)}
              <label className="text-xs font-semibold">Contact permission
                <select aria-label="Contact permission" className={control} value={profile.permission} onChange={(event) => change({ permission: event.target.value as OpportunityProfile['permission'] })}>
                  <option value="unknown">Unknown / needs verification</option><option value="permitted">Permitted individual follow-up (verified)</option><option value="do_not_contact">Do not contact</option>
                </select>
              </label>
              <label className="text-xs font-semibold">Verified contact route
                <select aria-label="Verified contact route" className={control} value={profile.contactability} onChange={(event) => change({ contactability: event.target.value as OpportunityProfile['contactability'] })}>
                  <option value="unknown">Unknown</option><option value="verified_email">Verified email</option><option value="verified_phone">Verified phone</option>
                </select>
              </label>
              <label className="text-xs font-semibold">Relationship
                <select aria-label="Business relationship" className={control} value={profile.relationship} onChange={(event) => change({ relationship: event.target.value as OpportunityProfile['relationship'] })}>
                  <option value="unknown">Unknown</option><option value="new">New business</option><option value="referred">Referred</option><option value="existing_client">Existing client</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold">Business evidence and contact permission reference
              <textarea aria-label="Business evidence reference" className={control} required maxLength={1000} value={profile.source_reference} onChange={(event) => change({ source_reference: event.target.value })} />
            </label>
            <label className="block text-xs font-semibold">Verified on (UTC)<input aria-label="Business facts confirmed on" className={control} type="date" required max={new Date().toISOString().slice(0, 10)} value={profile.confirmed_on} onChange={(event) => change({ confirmed_on: event.target.value })} /></label>
            <p className="text-xs text-cui-muted">Business-only facts; leave unknowns blank. This review never changes carrier appetite or enrolls anyone in marketing.</p>
            <button disabled={!dirty} className={composerSendClass}>Save reviewed business facts</button>
          </fieldset>
        </form>
      </details>
      <section className="space-y-2 rounded border border-cui-border bg-white p-3">
        <h3 className="text-sm font-semibold">Carrier evidence</h3>
        {data.assessment.markets.map((market) => <details key={market.document_id} open={market.status !== 'excluded'} className="rounded border border-cui-border p-2 text-sm">
          <summary className="cursor-pointer font-semibold">{market.carrier} · {market.coverage || market.title} · {{ possible_fit: 'Shortlist', needs_review: 'Review details', excluded: 'Not a fit' }[market.status]}</summary>
          <p className="mt-2 text-sm">{market.recommendation}</p>
          <p className="mt-2 text-xs">{market.summary || market.title}</p>
          <ul className="my-2 list-inside list-disc text-xs">{market.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <details><summary className="cursor-pointer text-xs text-cui-primary">Matching details and source pages</summary>
          {market.reasons.length > 4 ? <ul className="my-2 list-inside list-disc text-xs">{market.reasons.slice(4).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
          {market.rules.map((rule) => <div key={rule.id} className="my-2 border-t border-cui-border pt-2 text-xs">
            <p>{rule.criterion} · {rule.result.replace(/_/g, ' ')}</p><p className="text-cui-muted">{rule.reason}</p>
            <details><summary className="cursor-pointer text-cui-primary">Source page {rule.page}</summary><blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-cui-border pl-2">{rule.excerpt}</blockquote></details>
          </div>)}
          </details>
        </details>)}
        {!data.assessment.markets.length ? <p className="text-xs text-cui-muted">Activate reviewed carrier guidance before evaluating market fit.</p> : null}
      </section>
      <section className="rounded border border-cui-border bg-white p-3 text-sm">
        <h3 className="font-semibold">Agent briefing</h3>
        <p className="my-2">{data.assessment.briefing.opening}</p>
        <details open={data.assessment.missing.length > 0}><summary className="cursor-pointer font-semibold">Missing answers / checklist</summary>
          <ul className="my-2 list-inside list-disc text-xs">{data.assessment.briefing.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        </details>
        <details><summary className="cursor-pointer font-semibold">Discovery questions and observed changes</summary>
          <ul className="my-2 list-inside list-disc text-xs">{data.assessment.briefing.questions.map((item) => <li key={item}>{item}</li>)}</ul>
          {data.assessment.briefing.signals.map((signal) => <div className="my-2 text-xs" key={signal.detail}><strong>{signal.title}</strong><p>{signal.detail}</p><p>Evidence: {signal.evidence_ids.join(', ')}</p></div>)}
        </details>
        <fieldset disabled={busy || dirty} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">Assign review task<select aria-label="Opportunity task assignee" className={control} value={assignee} onChange={(event) => setAssignee(event.target.value)}>{data.agents.map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.email}</option>)}</select></label>
          <label className="text-xs">Due (your local time)<input aria-label="Opportunity task due" className={control} type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label>
          <button type="button" className={composerDraftClass} disabled={!due || !assignee} onClick={() => void run(async () => {
            const dueAt = new Date(due).toISOString(), key = JSON.stringify([data.evidence_token, dueAt, assignee]);
            if (taskRequest.current?.key !== key) taskRequest.current = { key, id: crypto.randomUUID() };
            await post({ action: 'task', task_id: taskRequest.current.id, due_at: dueAt, assignee });
            setNotice('Review task created with a link back to this business.');
          })}>Create review task</button>
        </fieldset>
      </section>
      <details className="rounded border border-cui-border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">Draft an individual follow-up</summary>
        <div className="mt-3">
        <h3 className="mb-2 text-sm font-semibold">Reviewed individual outreach</h3>
        {stale ? <p role="alert" className="mb-2 text-xs text-cui-danger">Evidence changed or expired. Prepare and save a new reviewed draft before approval.</p> : null}
        {locked ? <p role="status" className="mb-2 text-xs">Delivery state: {draft?.state}. Check conversation history before composing another message. This draft cannot be resent.</p> : null}
        {draft?.state === 'sent' ? <button type="button" disabled={busy || dirty} className={`${composerDraftClass} mb-2`} onClick={() => {
          setDraft(null); setSubject(''); setBody(''); setReviewed(false); setSendAttempted(false);
          draftId.current = crypto.randomUUID(); setNotice('A separate follow-up draft is open. The previous email and evidence history are retained.');
        }}>Start a separate follow-up</button> : null}
        <MessageComposer conversationKey={`${target.type}:${target.id}`} subject={subject} body={body} disabled={busy || dirty || locked}
          emailProvider={provider} onEmailProviderChange={setProvider} sender={<AgentSenderBadge />}
          onSubjectChange={(value) => { setSubject(value); setReviewed(false); }} onBodyChange={(value) => { setBody(value); setReviewed(false); }}
          draftAction={<div className="space-y-2"><button type="button" disabled={busy || dirty || locked || !data.profile.revision} className={composerDraftClass} onClick={() => void run(async () => {
            const prepared = await post<{ subject: string; body: string }>({ action: 'prepare' });
            setSubject(prepared.subject); setBody(prepared.body); setReviewed(false); setCitations([]);
          })}>Prepare permission-first draft</button>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={aiAllowed} disabled={busy || dirty || locked} onChange={(event) => setAiAllowed(event.target.checked)} />Use the business name, coverage line, current confirmed priorities / required lines / next step and any text I choose to rewrite in this AI request only. No carrier text.</label>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={useConversations} disabled={busy || dirty || locked} onChange={(event) => setUseConversations(event.target.checked)} />Also use this record's linked conversations, subject to all contributing agents' AI permissions. No unrelated mailbox search.</label>
            <button type="button" disabled={busy || dirty || locked || !aiAllowed || !data.profile.revision} className={composerDraftClass} onClick={() => void run(async () => {
              const generated = await post<{ subject: string; body: string; cited_signals: string[] }>({ action: 'prepare_ai', ai_confirmed: true, use_conversations: useConversations });
              setSubject(generated.subject); setBody(generated.body); setCitations(generated.cited_signals); setReviewed(false);
            })}>Draft grounded follow-up with AI</button>
            <button type="button" disabled={busy || dirty || locked || !aiAllowed || !body.trim() || !data.profile.revision} className={composerDraftClass} onClick={() => void run(async () => {
              const generated = await post<{ subject: string; body: string; cited_signals: string[] }>({ action: 'rewrite_ai', ai_confirmed: true,
                use_conversations: useConversations, input_subject: subject, input_body: body });
              setSubject(generated.subject); setBody(generated.body); setCitations(generated.cited_signals); setReviewed(false);
            })}>Rewrite current text with AI</button>
          </div>}
          actions={<>
            <button type="button" disabled={busy || dirty || locked || !body.trim() || !subject.trim() || !data.profile.revision} className={composerDraftClass} onClick={() => void run(async () => {
              const saved = await post<OpportunityDraft>({ action: 'save_draft', draft_id: draft?.id ?? draftId.current, revision: draft?.revision ?? 0, subject, body });
              setDraft(saved); setSubject(saved.subject); setBody(saved.body); setReviewed(false); setNotice('Draft saved with its exact evidence snapshot. Nothing was sent.');
            })}>Save reviewed draft</button>
            <button type="button" className={composerSendClass} disabled={busy || dirty || draftDirty || stale || locked || sendAttempted || draft?.state !== 'approved'} onClick={() => {
              if (!window.confirm('Send this exact reviewed email now through your selected CRM provider?')) return;
              void run(async () => {
                setSendAttempted(true);
                await workspaceFetch('/api/intelligence/opportunities/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: target.type, id: target.id, draft_id: draft?.id, email_provider: provider }) });
                await load(); setNotice('Email accepted through the existing guarded delivery path. Check conversation history for delivery updates.');
              });
            }}>Send reviewed email</button>
          </>} />
        {sendAttempted ? <p role="status" className="mt-2 text-xs">A delivery request was started. Reload this opportunity and check conversation history before any further action.</p> : null}
        {draft && !locked ? <div className="mt-3 space-y-2">
          <label className="flex gap-2 text-xs"><input type="checkbox" disabled={busy || dirty || draftDirty || stale} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the exact text, current evidence and permission. No unsupported savings, coverage gaps or market promises.</label>
          <button type="button" className={composerDraftClass} disabled={busy || dirty || draftDirty || stale || !reviewed || draft.state === 'approved'} onClick={() => void run(async () => {
            const approved = await post<OpportunityDraft>({ action: 'approve', draft_id: draft.id, revision: draft.revision, subject, body, review_confirmed: true });
            setDraft(approved); setNotice('Draft approved for individual email only. Sending still requires your explicit action.');
          })}>Approve exact draft</button>
        </div> : null}
        {citations.length ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-cui-primary">Draft grounding</summary><ul className="list-inside list-disc">{citations.map((citation) => <li key={citation}>{citation}</li>)}</ul></details> : null}
        </div>
      </details>
      <OpportunityOperations target={target} />
    </>}
  </section>;
}
