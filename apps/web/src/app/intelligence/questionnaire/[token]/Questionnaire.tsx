'use client';
import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../../../lib/workspace-fetch';
export default function Questionnaire({ token }: { token: string }): JSX.Element {
  const [data, setData] = useState<{ questions: string; submitted: boolean } | null>(null);
  const [response, setResponse] = useState(''), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const endpoint = `/api/intelligence/questionnaire/${encodeURIComponent(token)}`;
  useEffect(() => {
    void workspaceFetch<{ questions: string; submitted: boolean }>(endpoint).then(setData)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Questionnaire could not be loaded.'));
  }, [endpoint]);
  return <main className="mx-auto max-w-2xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">Business insurance discovery</h1>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {data?.submitted ? <p role="status">Your response was recorded. Your agent will review it.</p> : data ? <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError('');
      void workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response, consent }) })
        .then(() => setData({ ...data, submitted: true }))
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Response could not be recorded. Retry unchanged.'))
        .finally(() => setBusy(false));
    }}>
      <p className="whitespace-pre-wrap break-words rounded border border-cui-border bg-white p-3 text-sm">{data.questions}</p>
      <label className="block text-sm">Your business response<textarea required disabled={busy} maxLength={3000} rows={8} className="mt-1 w-full rounded border border-cui-border p-3" value={response} onChange={(event) => setResponse(event.target.value)} /></label>
      <p className="text-xs text-cui-muted">Business information only. Do not enter identity numbers, payment details, personal health information or private loss records. Send documents through your agent's approved private channel.</p>
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />I authorize my agent to retain and review this business response in the CRM. This is not marketing consent.</label>
      <button disabled={busy || !consent} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit for agent review</button>
    </form> : !error ? <p>Loading questionnaire...</p> : null}
  </main>;
}
