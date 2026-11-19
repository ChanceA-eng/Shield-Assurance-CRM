'use client';

import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { putToSignedUrl } from '../../../lib/account-document-client';
import type { ProspectAnswers, ProspectContact, QuestionnaireDesign } from '../../../lib/prospect-questionnaires';
import { useUnsavedChanges } from '../../../context/WorkspaceNavigationContext';

interface Upload { id: string; name: string; question_id: string; state: string }
interface Form { design: QuestionnaireDesign; expires_at: string; recipient_name: string; contact: ProspectContact; files: Upload[] }
const label = 'block space-y-2 text-sm font-semibold text-slate-200';
const input = 'w-full rounded-xl border border-white/15 bg-slate-950/50 px-4 py-3 text-sm font-normal text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 [color-scheme:dark]';
const primary = 'w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60';
const link = 'text-sm font-semibold text-cyan-200 underline disabled:opacity-60';
const fileState = (state: string): string => state === 'pending' ? 'Checking file' : state === 'clean' ? 'Received' : 'Not accepted';
export default function ProspectQuestionnaire({ token }: { token: string }): JSX.Element {
  const [form, setForm] = useState<Form | null>(null);
  const [checking, setChecking] = useState(true);
  const [codeSent, setCodeSent] = useState(false);
  const [answers, setAnswers] = useState<ProspectAnswers>({});
  const [code, setCode] = useState('');
  const [contact, setContact] = useState<ProspectContact>({ first_name: '', last_name: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [closed, setClosed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!form || submitted) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [form, submitted]);
  const expired = closed || Boolean(form && Date.parse(form.expires_at) <= now);
  const { markSaved } = useUnsavedChanges(!submitted && Object.values(answers).some((value) => value.length > 0));
  const endpoint = `/api/questionnaire/${encodeURIComponent(token)}`;
  const post = <T,>(body: Record<string, unknown>): Promise<T> => workspaceFetch<T>(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const load = async (allowUnverified = false): Promise<void> => {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const result: Form | { submitted: true } | { message: string } = await response.json();
    if (response.status === 401 && allowUnverified) return;
    if (!response.ok || 'message' in result) {
      if (response.status === 410) { setClosed(true); setForm(null); }
      throw new Error('message' in result ? result.message : 'Your form could not be loaded. Please try again.');
    }
    if ('submitted' in result) { markSaved(); setSubmitted(true); setAnswers({}); setForm(null); return; }
    setForm(result);
    setContact(result.contact);
    const fullName = `${result.contact.first_name} ${result.contact.last_name}`;
    setAnswers((previous) => {
      const next = { ...previous };
      for (const question of result.design.questions) {
        if (question.field === 'full_name' && !next[question.id]) next[question.id] = fullName;
      }
      return next;
    });
  };
  useEffect(() => { void load(true).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Your form could not be loaded. Please try again.')).finally(() => setChecking(false)); }, [token]);
  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  const sendCode = (): void => void act(async () => {
    await post({ action: 'challenge', contact }); setCodeSent(true); setCode('');
    setNotice('We emailed you a 6-digit code. It expires in 10 minutes. Check your spam folder if you do not see it.');
  });
  const upload = (questionId: string, file?: File): void => {
    if (!file) return;
    void act(async () => {
      const ticket = await post<{ id: string; signed_url: string; content_type: string }>({
        action: 'upload', question_id: questionId, name: file.name, size: file.size,
      });
      setNotice(`Uploading ${file.name}…`);
      const result = await putToSignedUrl(ticket.signed_url, file, file.name, ticket.content_type, (progress) => {
        setNotice(`Uploading ${file.name}: ${Math.round(progress * 100)}%`);
      });
      await load();
      if (!result.ok) throw new Error(result.message);
      setNotice(`${file.name} uploaded.`);
    });
  };
  const title = submitted ? 'Thank you' : expired ? 'Link closed' : form?.design.name ?? (codeSent ? 'Enter your code' : 'Confirm it’s you');
  const intro = submitted ? 'Your information was sent to your agent. You can close this page.'
    : expired ? 'Contact your agent for a new link.'
      : form ? `For ${form.recipient_name}. Complete the fields below and submit when you are done.`
      : codeSent ? 'Enter the 6-digit code from your email to open your form.'
        : 'Enter your name and we will email you a code to open your form.';
  return <main className="relative min-h-screen overflow-hidden bg-[#091424] px-4 py-10 text-white sm:py-16">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(135deg,_rgba(17,24,39,0.94),_rgba(8,22,43,0.98))]" />
    <div className={`relative mx-auto w-full rounded-[28px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur sm:p-8 ${form ? 'max-w-2xl' : 'max-w-md'}`}>
      <div className="mb-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/80">Shield Assurance</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="text-sm leading-6 text-slate-300">{intro}</p>
      </div>
      {error ? <div role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}
      {notice ? <p role="status" className="mb-4 text-sm text-cyan-100">{notice}</p> : null}
      {submitted || expired || checking ? null : !form ? (codeSent ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void act(async () => {
        await post({ action: 'verify', code }); await load(); setCode('');
      }); }}>
        <label className={label}>Verification code<input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
          disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className={`${input} text-center text-lg tracking-[0.5em]`} /></label>
        <button className={primary} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button>
        <div className="flex justify-between gap-3">
          <button type="button" className={link} disabled={busy} onClick={sendCode}>Send a new code</button>
          <button type="button" className={link} disabled={busy} onClick={() => { setCodeSent(false); setNotice(''); setError(''); }}>Change name</button>
        </div>
      </form> : <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); sendCode(); }}>
        <label className={label}>First name<input required autoComplete="given-name" maxLength={80} disabled={busy} value={contact.first_name}
          onChange={(event) => setContact({ ...contact, first_name: event.target.value })} className={input} /></label>
        <label className={label}>Last name<input required autoComplete="family-name" maxLength={80} disabled={busy} value={contact.last_name}
          onChange={(event) => setContact({ ...contact, last_name: event.target.value })} className={input} /></label>
        <button className={primary} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
      </form>) : <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); void act(async () => {
        await post({ action: 'submit', answers, consent }); markSaved(); setSubmitted(true); setAnswers({}); setForm(null);
      }); }}>
        <p className="text-xs text-slate-400">Submit within {Math.max(1, Math.ceil((Date.parse(form.expires_at) - now) / 60000))} minutes. The link closes when you submit. Uploaded files are deleted 24 hours after submission.</p>
        <fieldset disabled={busy} className="space-y-5">
          {form.design.questions.map((question) => {
            const value = answers[question.id] ?? '';
            const text = typeof value === 'string' ? value : '';
            const change = (next: string | string[]): void => setAnswers({ ...answers, [question.id]: next });
            const heading = `${question.label}${question.required ? ' *' : ''}`;
            return <div key={question.id}>
              {question.type === 'file' ? <fieldset className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-200">{heading}</legend>
                <p className="text-xs text-slate-400">PDF or photo, up to 10 MB each.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-slate-300">Choose a file<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" className={`${input} mt-1 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:text-slate-950`}
                    onChange={(event) => { upload(question.id, event.target.files?.[0]); event.target.value = ''; }} /></label>
                  <label className="block text-sm text-slate-300">Take a photo<input type="file" accept="image/*" capture="environment" className={`${input} mt-1 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-3 file:py-1 file:text-slate-950`}
                    onChange={(event) => { upload(question.id, event.target.files?.[0]); event.target.value = ''; }} /></label>
                </div>
                <ul className="space-y-2">{form.files.filter((file) => file.question_id === question.id).map((file) => <li key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{file.name} · {fileState(file.state)}</span>
                  <button type="button" className="shrink-0 text-red-200 underline" onClick={() => void act(async () => {
                    await post({ action: 'remove_file', id: file.id }); await load();
                  })}>Remove</button>
                </li>)}</ul>
              </fieldset> : question.type === 'multiple' ? <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-slate-200">{heading}</legend>
                {question.options.map((option) => <label key={option} className="flex gap-2 text-sm text-slate-200"><input type="checkbox" className="accent-cyan-300" checked={Array.isArray(value) && value.includes(option)}
                  onChange={(event) => change(event.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value : []).filter((item) => item !== option))} />{option}</label>)}
              </fieldset> : <label className={label}>{heading}
                {question.type === 'long_text' ? <textarea rows={4} maxLength={4000} required={question.required} value={text} onChange={(event) => change(event.target.value)} className={input} />
                  : ['choice', 'yes_no'].includes(question.type) ? <select required={question.required} value={text} onChange={(event) => change(event.target.value)} className={input}>
                    <option value="">Choose</option>{(question.type === 'yes_no' ? ['Yes', 'No'] : question.options).map((option) => <option key={option}>{option}</option>)}
                  </select> : <input required={question.required} type={question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text'}
                    step={question.type === 'number' ? 'any' : undefined} maxLength={500} value={text} onChange={(event) => change(event.target.value)} className={input} />}
              </label>}
            </div>;
          })}
          <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" required className="mt-1 accent-cyan-300" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            I reviewed my answers and authorize sharing these answers and documents with Shield Assurance for this request.</label>
          <button className={primary}>{busy ? 'Submitting…' : 'Submit to my agent'}</button>
        </fieldset>
      </form>}
    </div>
  </main>;
}
