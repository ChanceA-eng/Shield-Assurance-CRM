'use client';
import { useState } from 'react';
import type { EmailChange } from '../../lib/account-security';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
export default function AccountEmailApprovals({ initial }: { initial: EmailChange[] | null }): JSX.Element {
  const [requests, setRequests] = useState(initial ?? []);
  const [error, setError] = useState(initial ? '' : 'Email requests could not load.');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (): Promise<void> => {
    const result = await workspaceFetch<{ requests: EmailChange[] }>('/api/settings/account-email');
    setRequests(result.requests); setError('');
  };
  const decide = async (id: string, approve: boolean): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workspaceFetch<{ message: string }>('/api/settings/account-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, approve }),
      });
      setNotice(result.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Request could not be updated.'); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader>Sign-in email requests</CardHeader><CardBody>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error} <button className="underline" onClick={() => void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Retry failed.'))}>Retry</button></p> : null}
    {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
    {!requests.length && !error ? <p className="text-sm text-cui-muted">No pending email change requests.</p> : null}
    {requests.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-cui-border py-3">
      <p className="break-all text-sm">{item.old_email} → {item.new_email}</p>
      <div className="flex gap-3"><button disabled={busy} onClick={() => void decide(item.id, true)} className="text-sm font-semibold text-cui-primary">Approve</button>
        <button disabled={busy} onClick={() => void decide(item.id, false)} className="text-sm font-semibold text-cui-danger">Reject</button></div>
    </div>)}
  </CardBody></Card>;
}
