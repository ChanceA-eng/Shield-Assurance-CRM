'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

interface Account {
  email: string;
  full_name: string;
  contact_phone: string;
  role: 'owner' | 'admin' | 'agent' | null;
}

export default function MyAccountForm({ onSaved }: { onSaved?: () => void }): JSX.Element {
  const [account, setAccount] = useState<Account | null>(null);
  const [baseline, setBaseline] = useState('');
  useUnsavedChanges(Boolean(account) && JSON.stringify(account) !== baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { const saved = await workspaceFetch<Account>('/api/account'); setAccount(saved); setBaseline(JSON.stringify(saved)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your account could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <Card><CardHeader>My profile</CardHeader><CardBody>
    {error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="mb-3 text-sm text-green-800">{notice}</p> : null}
    {!account ? <button type="button" onClick={() => void load()} className="text-sm text-cui-primary underline">Load my profile</button> : <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError(''); setNotice('');
      void workspaceFetch<{ message: string }>('/api/account', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: account.full_name, contact_phone: account.contact_phone }),
      }).then((result) => {
        setBaseline(JSON.stringify(account));
        setNotice(result.message);
        window.dispatchEvent(new Event('crm:account-updated'));
        onSaved?.();
      })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Your account could not be saved.'))
        .finally(() => setBusy(false));
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Sign-in email<input readOnly type="email" value={account.email} className="mt-1 w-full rounded border border-cui-border bg-cui-light px-3 py-2" /></label>
        <label className="text-sm font-semibold">Agency role<input readOnly value={account.role ?? 'No agency membership assigned'} className="mt-1 w-full rounded border border-cui-border bg-cui-light px-3 py-2" /></label>
        <label className="text-sm font-semibold">Display name<input required maxLength={120} value={account.full_name} disabled={busy} onChange={(event) => setAccount({ ...account, full_name: event.target.value })} className="mt-1 w-full rounded border border-cui-border px-3 py-2" /></label>
        <label className="text-sm font-semibold">Contact phone<input type="tel" maxLength={40} value={account.contact_phone} disabled={busy} onChange={(event) => setAccount({ ...account, contact_phone: event.target.value })} className="mt-1 w-full rounded border border-cui-border px-3 py-2" /></label>
      </div>
      <p className="text-xs text-cui-muted">Contact phone is not used for sign-in or SMS verification.</p>
      <button disabled={busy} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Saving...' : 'Save my profile'}</button>
    </form>}
  </CardBody></Card>;
}
