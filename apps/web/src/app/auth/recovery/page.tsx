'use client';
import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../../lib/workspace-fetch';

export default function RecoverPassword(): JSX.Element {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <main className="flex min-h-screen items-center justify-center bg-cui-body p-4"><section className="w-full max-w-md space-y-4 rounded border border-cui-border bg-white p-6">
    <h1 className="text-xl font-semibold">Reset password</h1>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {done ? <><p role="status" className="text-sm">Password changed.</p><a href="/account?tab=security" className="text-cui-primary underline">Open My Account</a></> : <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError('');
      void workspaceFetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm_password: confirm }) })
        .then(() => { setPassword(''); setConfirm(''); setDone(true); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Password could not be reset.'))
        .finally(() => setBusy(false));
    }}>
      <label className="block text-sm font-semibold">New password<input disabled={!ready} required minLength={12} maxLength={72} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-cui-border p-2" /></label>
      <label className="block text-sm font-semibold">Confirm new password<input disabled={!ready} required minLength={12} maxLength={72} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-1 w-full rounded border border-cui-border p-2" /></label>
      <button disabled={busy || !ready} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save new password'}</button>
    </form>}
  </section></main>;
}
