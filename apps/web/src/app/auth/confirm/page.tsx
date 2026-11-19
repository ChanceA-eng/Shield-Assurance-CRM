'use client';

import { useState } from 'react';
import { workspaceFetch } from '../../../lib/workspace-fetch';

export default function ConfirmAccount(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return <main className="flex min-h-screen items-center justify-center bg-cui-body p-4">
    <section className="w-full max-w-md space-y-4 rounded border border-cui-border bg-white p-6">
      <h1 className="text-xl font-semibold">Confirm account request</h1>
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-cui-text">{message}</p> : <button disabled={busy}
        className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() => {
          setBusy(true); setError('');
          const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
          void workspaceFetch<{ message: string; recovery?: boolean }>('/api/auth/confirm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: params.get('type'), token_hash: params.get('token_hash') }),
          }).then((result) => {
            window.history.replaceState(null, '', '/auth/confirm');
            if (result.recovery) window.location.assign('/auth/recovery');
            else setMessage(result.message);
          }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'This link could not be verified.'))
            .finally(() => setBusy(false));
        }}>{busy ? 'Verifying...' : 'Confirm and continue'}</button>}
      <a href="/login" className="block text-sm text-cui-primary underline">Back to sign in</a>
    </section>
  </main>;
}
