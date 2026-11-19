'use client';

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { QUESTION_FIELDS, QUESTION_TYPES, type ProspectAnswers, type ProspectContact, type ProspectQuestion, type QuestionnaireDesign, type QuestionnaireTemplate } from '../../lib/prospect-questionnaires';
import EmailProviderControl, { type EmailProviderChoice } from './EmailProviderControl';

interface Submission { id: string; revision: number; answers: ProspectAnswers; design: QuestionnaireDesign; state: string; contact: ProspectContact; created_at: string }
interface RequestRow {
  id: string; recipient: string; recipient_name: string; state: string; expires_at: string;
  target_type: 'lead' | 'client' | null; target_id: string | null; can_reopen: boolean;
  submissions: Submission[]; current_values: Record<string, string | null>;
  files: Array<{ id: string; revision: number; name: string; state: string }>;
}
const input = 'crm-input mt-1';
const button = 'crm-button';
const blank = (): QuestionnaireDesign => ({ name: '', questions: [{ id: crypto.randomUUID(), label: '', type: 'text', required: false, options: [], field: '' }] });
const displayAnswer = (value: string | string[] | undefined): string => Array.isArray(value) ? value.join(', ') : value || 'Not provided';
export default function IntakeRequestDialog({ target, onClose, onReviewed }: {
  target?: { type: 'lead' | 'client'; id: string };
  onClose: () => void;
  onReviewed?: () => void;
}): JSX.Element {
  const type = target?.type, id = target?.id;
  const returnFocus = useRef<HTMLElement | null>(null);
  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [design, setDesign] = useState<QuestionnaireDesign | null>(null);
  const [identity, setIdentity] = useState<{ id: string; expected: number; source_id?: string }>({ id: '', expected: 0 });
  const [baseline, setBaseline] = useState('');
  const [requestBaseline, setRequestBaseline] = useState('');
  const [recipient, setRecipient] = useState('');
  const [name, setName] = useState('');
  const [issuedLink, setIssuedLink] = useState<{ id: string; url: string; recipient: string; name: string; expiresAt: string; sendId: string; provider?: EmailProviderChoice; sent?: boolean } | null>(null);
  const [emailProvider, setEmailProvider] = useState<EmailProviderChoice>('default');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Record<string, string[]>>({});
  const requestDraft = JSON.stringify({ recipient, name });
  const { confirmDiscard, markSaved } = useUnsavedChanges((Boolean(design) && JSON.stringify(design) !== baseline)
    || (Boolean(recipient || name) && requestDraft !== requestBaseline));
  const close = (): void => {
    if (busy || !confirmDiscard()) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('intake')) {
      url.searchParams.delete('intake');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    onClose();
  };
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const api = <T,>(body: Record<string, unknown>): Promise<T> => workspaceFetch<T>('/api/questionnaires', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const load = async (): Promise<void> => {
    const [library, rows] = await Promise.all([
      workspaceFetch<QuestionnaireTemplate[]>('/api/questionnaires?action=templates'),
      workspaceFetch<RequestRow[]>(`/api/questionnaires?action=requests${id && type ? `&target_type=${encodeURIComponent(type)}&target_id=${encodeURIComponent(id)}` : ''}`),
    ]);
    setTemplates(library); setRequests(rows);
  };
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Questionnaires could not be loaded.')); }, [id, type]);
  useEffect(() => {
    let cancelled = false;
    setName(''); setRecipient(''); setIssuedLink(null); setRequestBaseline('');
    if (id && type) {
      void workspaceFetch<{ name: string; email: string | null }>(`/api/questionnaires?action=context&target_type=${encodeURIComponent(type)}&target_id=${encodeURIComponent(id)}`)
        .then((contact) => {
          if (cancelled) return;
          setName((current) => current || contact.name); setRecipient((current) => current || contact.email || '');
          setRequestBaseline(JSON.stringify({ recipient: contact.email ?? '', name: contact.name }));
        })
        .catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Record contact details could not be loaded.'); });
    }
    return () => { cancelled = true; };
  }, [id, type]);
  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'This change could not be completed.'); }
    finally { setBusy(false); }
  };
  const choose = (template?: QuestionnaireTemplate): void => {
    if (!confirmDiscard()) return;
    const next = template ? { name: template.name, questions: template.questions } : blank();
    setDesign(next); setBaseline(JSON.stringify(next)); setIssuedLink(null);
    setIdentity(template?.owner_id ? { id: template.id, expected: template.revision }
      : { id: crypto.randomUUID(), expected: 0, ...(template ? { source_id: template.id } : {}) });
  };
  const changeQuestion = (index: number, patch: Partial<ProspectQuestion>): void => {
    if (design) setDesign({ ...design, questions: design.questions.map((question, position) => position === index ? { ...question, ...patch } : question) });
  };
  const save = async (): Promise<QuestionnaireTemplate> => {
    if (!design) throw new Error('Choose a questionnaire.');
    const saved = await api<QuestionnaireTemplate>({ action: 'save_template', ...identity, design });
    const savedDesign = { name: saved.name, questions: saved.questions };
    setIdentity({ id: saved.id, expected: saved.revision }); setDesign(savedDesign); setBaseline(JSON.stringify(savedDesign)); markSaved();
    return saved;
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-sm" />
      <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[111] flex max-h-[92dvh] w-[min(96vw,72rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-cui-border bg-cui-body text-cui-text shadow-panel"
        aria-describedby="intake-request-description"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-cui-dark px-5 py-3 text-white">
          <div><Dialog.Title className="text-lg font-bold">Intake requests</Dialog.Title>
            <Dialog.Description id="intake-request-description" className="text-xs text-slate-300">Links expire 30 minutes after generation or close when submitted.</Dialog.Description></div>
          <button type="button" aria-label="Close intake requests" disabled={busy} onClick={close} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <div className="flex flex-wrap items-start gap-4">
      <section className="w-full space-y-3 rounded-xl border border-cui-border bg-cui-panel p-4 lg:w-56">
        <button type="button" className={button} disabled={busy} onClick={() => choose()}>New template</button>
        {(['Shared templates', 'My templates'] as const).map((label) => <div key={label}>
          <h2 className="mb-2 text-sm font-bold">{label}</h2>
          <ul className="space-y-2">{templates.filter((template) => label === 'Shared templates' ? !template.owner_id : Boolean(template.owner_id)).map((template) =>
            <li key={template.id}><button type="button" className="text-left text-sm text-cui-primary underline" disabled={busy} onClick={() => choose(template)}>{template.name}</button></li>)}</ul>
        </div>)}
      </section>
      {design ? <section className="min-w-0 flex-1 space-y-4 rounded-xl border border-cui-border bg-cui-panel p-4">
        <h2 className="font-bold">{identity.source_id ? 'Customize as my template' : 'My intake form'}</h2>
        <label className="block text-sm">Template name<input disabled={busy} value={design.name} maxLength={120} className={input} onChange={(event) => setDesign({ ...design, name: event.target.value })} /></label>
        <fieldset disabled={busy} className="space-y-3">
          {design.questions.map((question, index) => <div key={question.id} className="space-y-2 rounded border border-cui-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Question {index + 1}<input value={question.label} maxLength={300} className={input} onChange={(event) => changeQuestion(index, { label: event.target.value })} /></label>
              <label className="text-sm">Answer type<select value={question.type} className={input} onChange={(event) => {
                const next = QUESTION_TYPES.find((entry) => entry === event.target.value);
                if (next) changeQuestion(index, { type: next, options: [], field: '' });
              }}>{QUESTION_TYPES.map((entry) => <option key={entry} value={entry}>{({ text: 'Short text', long_text: 'Long text', number: 'Number', date: 'Date', choice: 'Choose one', multiple: 'Choose several', yes_no: 'Yes / No', file: 'Document / photo' })[entry]}</option>)}</select></label>
            </div>
            {['choice', 'multiple'].includes(question.type) ? <label className="block text-sm">Choices (one per line)<textarea className={input} rows={3}
              value={question.options.join('\n')} onChange={(event) => changeQuestion(index, { options: event.target.value.split('\n') })} /></label> : null}
            {question.type === 'text' ? <label className="block text-sm">Optional CRM field<select className={input} value={question.field} onChange={(event) => changeQuestion(index, { field: QUESTION_FIELDS.find((entry) => entry === event.target.value) ?? '' })}>
              <option value="">Keep as questionnaire answer</option>{QUESTION_FIELDS.map((entry) => <option key={entry} value={entry}>{({ full_name: 'Full name', phone: 'Phone', address: 'Address', line_of_business: 'Line of business' })[entry]}</option>)}
            </select></label> : null}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex gap-2"><input type="checkbox" checked={question.required} onChange={(event) => changeQuestion(index, { required: event.target.checked })} />Required</label>
              <button type="button" disabled={index === 0} className={button} onClick={() => { const next = [...design.questions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setDesign({ ...design, questions: next }); }}>Move up</button>
              <button type="button" disabled={index === design.questions.length - 1} className={button} onClick={() => { const next = [...design.questions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; setDesign({ ...design, questions: next }); }}>Move down</button>
              <button type="button" className="text-cui-danger underline" onClick={() => setDesign({ ...design, questions: design.questions.filter((entry) => entry.id !== question.id) })}>Remove question</button>
            </div>
          </div>)}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={design.questions.length >= 50} onClick={() => setDesign({ ...design, questions: [...design.questions, { id: crypto.randomUUID(), label: '', type: 'text', required: false, options: [], field: '' }] })}>Add question</button>
            <button type="button" className={button} onClick={() => void act(async () => { await save(); await load(); setNotice('Your template was saved.'); })}>Save my template</button>
          </div>
        </fieldset>
        <form className="space-y-3 border-t border-cui-border pt-4" onSubmit={(event) => { event.preventDefault(); void act(async () => {
          if (!identity.expected && !identity.source_id) throw new Error('Save your new template before generating a request.');
          const result = await api<{ request: { id: string; expires_at: string }; path: string }>({ action: 'create_request', template_id: identity.source_id ?? identity.id, design,
            recipient, recipient_name: name,
            ...(id && type ? { target_type: type, target_id: id } : {}) });
          setIssuedLink({ id: result.request.id, url: new URL(result.path, window.location.origin).href, recipient, name, expiresAt: result.request.expires_at, sendId: crypto.randomUUID() });
          setRequestBaseline(requestDraft); await load(); setNotice('Request created. Copy the link or send the invitation.');
        }); }}>
          <h3 className="font-semibold">New request{!id ? ' for a new prospect' : ''}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Recipient name<input required disabled={busy} value={name} onChange={(event) => setName(event.target.value)} className={input} /></label>
            <label className="text-sm">Recipient email<input required disabled={busy} type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} className={input} /></label>
          </div>
          <button className="crm-button-primary" disabled={busy}>Generate link</button>
        </form>
      </section> : <p className="text-sm text-cui-muted">Choose a template or create your own.</p>}
    </div>
    {issuedLink ? <div className="space-y-2 rounded border border-cui-border p-3">
      <label className="block text-sm">New request link<input readOnly value={issuedLink.url} className={input} /></label>
      <p className="text-sm">{issuedLink.name} · {issuedLink.recipient}</p>
      <p className="text-xs font-semibold text-cui-muted">{Date.parse(issuedLink.expiresAt) <= now ? 'Link expired. Generate a replacement below.' : `Expires ${new Date(issuedLink.expiresAt).toLocaleTimeString()}`}</p>
      <div className="flex flex-wrap gap-3">
        <EmailProviderControl value={issuedLink.provider ?? emailProvider} onChange={setEmailProvider} disabled={busy || Boolean(issuedLink.provider)} compact />
        <button type="button" className="crm-button-primary" disabled={busy || issuedLink.sent || Date.parse(issuedLink.expiresAt) <= now} onClick={() => void act(async () => {
          const provider = issuedLink.provider ?? emailProvider;
          setIssuedLink({ ...issuedLink, provider });
          await api({ action: 'invitation', id: issuedLink.id, token: issuedLink.url.split('/').pop(),
            request_id: issuedLink.sendId, email_provider: provider });
          setIssuedLink({ ...issuedLink, provider, sent: true }); setNotice('Invitation sent.');
        })}>{issuedLink.sent ? 'Invitation sent' : 'Send invitation'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(issuedLink.url); setNotice('Link copied.'); })}>Copy link</button>
        <a className="text-sm text-cui-primary underline" href={`mailto:${encodeURIComponent(issuedLink.recipient)}?subject=${encodeURIComponent('Your Shield Assurance Secure Intake')}&body=${encodeURIComponent(`Hi ${issuedLink.name},\n\nPlease complete your information and requested documents using this secure link:\n${issuedLink.url}\n\nEnter your first and last name, then verify the code sent to your email to continue.`)}`}>Open email app</a>
      </div>
    </div> : null}
    <section className="space-y-3">
      <h2 className="font-bold">Requests &amp; submissions</h2>
      <button type="button" className={button} disabled={busy} onClick={() => void act(load)}>Refresh requests</button>
      {!requests.length ? <p className="text-sm text-cui-muted">No requests yet.</p> : null}
      {requests.map((row) => <details key={row.id} className="rounded border border-cui-border bg-cui-panel p-4">
        <summary className="cursor-pointer font-semibold">{row.recipient_name} · {row.state === 'open' && Date.parse(row.expires_at) <= now ? 'expired' : row.state}
          {row.submissions.some((submission) => submission.state === 'needs_review') ? ' · Needs review' : ''}</summary>
        <p className="my-2 text-sm">{row.recipient}{row.state === 'open' ? ` · Expires ${new Date(row.expires_at).toLocaleString()}` : ''}</p>
        {row.target_id && row.target_id !== id ? <Link href={(row.target_type === 'lead' ? `/leads?lead=${row.target_id}` : `/clients/${row.target_id}`) as Route} className="text-sm text-cui-primary-strong underline">Open record</Link> : null}
        {row.state === 'open' ? <button type="button" className={`${button} ml-3`} disabled={busy} onClick={() => {
          if (window.confirm('Revoke this link? The prospect will no longer be able to submit.')) void act(async () => { await api({ action: 'revoke', id: row.id }); await load(); });
        }}>Revoke link</button> : null}
        {(row.state === 'submitted' && row.can_reopen) || row.state === 'open' ? <form className="my-3 flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          void act(async () => { const result = await api<{ request: { expires_at: string }; path: string }>({ action: row.state === 'submitted' ? 'reopen' : 'rotate', id: row.id });
            setIssuedLink({ id: row.id, url: new URL(result.path, window.location.origin).href, recipient: row.recipient, name: row.recipient_name, expiresAt: result.request.expires_at, sendId: crypto.randomUUID() });
            await load(); setNotice('New link generated. Previous links and verification sessions are invalid.'); });
        }}><button className={button} disabled={busy}>{row.state === 'submitted' ? 'Reopen as new revision' : 'Replace open link'}</button></form> : null}
        {row.submissions.map((submission) => <div key={submission.id} className="mt-4 space-y-3 border-t border-cui-border pt-3">
          <h3 className="text-sm font-bold">Submission {submission.revision} · {submission.state === 'needs_review' ? 'Needs review' : submission.state}</h3>
          <p className="text-sm">{submission.contact.first_name} {submission.contact.last_name} · Files expire {new Date(Date.parse(submission.created_at) + 24 * 3600000).toLocaleString()}</p>
          {submission.design.questions.filter((question) => question.type !== 'file').map((question) => <div key={question.id} className="text-sm">
            <p className="font-semibold">{question.label}</p><p className="whitespace-pre-wrap">{displayAnswer(submission.answers[question.id])}</p>
            {question.field && submission.state === 'needs_review' ? <label className="mt-1 flex gap-2">
              <input type="checkbox" disabled={row.target_type === 'client' && question.field === 'line_of_business'}
                checked={selectedFields[submission.id]?.includes(question.field) ?? false} onChange={(event) => {
                  const previous = selectedFields[submission.id] ?? [];
                  setSelectedFields({ ...selectedFields, [submission.id]: event.target.checked ? [...previous, question.field] : previous.filter((field) => field !== question.field) });
                }} />Apply to {question.field.replaceAll('_', ' ')} (currently: {row.current_values[question.field] || 'empty'})
            </label> : null}
          </div>)}
          <ul className="space-y-2">{row.files.filter((file) => file.revision === submission.revision).map((file) => <li key={file.id} className="text-sm">
            {file.name} · {file.state === 'pending' ? 'Awaiting file-safety check' : file.state}
            {file.state === 'clean' ? <a href={`/api/questionnaires/files/${file.id}`} target="_blank" rel="noreferrer" className="ml-3 text-cui-primary underline">Download</a> : null}
          </li>)}</ul>
          {submission.state === 'needs_review' ? <div className="flex gap-3">
            {(['accepted', 'rejected'] as const).map((decision) => <button key={decision} type="button" className={button} disabled={busy} onClick={() => void act(async () => {
              await api({ action: 'review', id: row.id, submission_id: submission.id, decision, fields: selectedFields[submission.id] ?? [], expected_values: row.current_values });
              await load(); onReviewed?.(); setNotice(decision === 'accepted' ? 'Submission reviewed. Selected fields applied.' : 'Submission rejected; original answers retained.');
            })}>{decision === 'accepted' ? 'Accept reviewed answers' : 'Reject submission'}</button>)}
          </div> : null}
        </div>)}
      </details>)}
    </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
