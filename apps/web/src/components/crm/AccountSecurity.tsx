'use client';
import { useEffect, useState } from 'react';
import type { EmailChange } from '../../lib/account-security';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

interface SecurityAccount { email: string; role: string | null; active: boolean; email_verified: boolean; can_change_email: boolean; email_change: EmailChange | null }
const input = 'crm-input mt-1';
export default function AccountSecurity(): JSX.Element {
  const [account, setAccount] = useState<SecurityAccount | null>(null);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async (): Promise<void> => { setAccount(await workspaceFetch<SecurityAccount>('/api/account')); };
  useEffect(() => {
    const refresh = (): void => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Account security could not load.')); };
    refresh(); window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const act = async (endpoint: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workspaceFetch<{ message: string }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setNotice(result.message); setCurrent(''); setPassword(''); setConfirm('');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Account security could not be updated.'); }
    finally { setBusy(false); }
  };
  const change = account?.email_change;
  const activeChange = change && ['pending', 'approved'].includes(change.status) && Date.parse(change.expires_at) > Date.now();
  return <div className="space-y-5">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error} <button type="button" className="underline" onClick={() => void load().then(() => setError('')).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Retry failed.'))}>Retry</button></p> : null}
    {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
    <Card><CardHeader>Password</CardHeader><CardBody>
      <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void act('/api/account/password', { current_password: current, password, confirm_password: confirm }); }}>
        <label className="block text-sm font-semibold">Current password<input required type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} className={input} /></label>
        <label className="block text-sm font-semibold">New password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={input} /></label>
        <label className="block text-sm font-semibold">Confirm new password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={input} /></label>
        <button disabled={busy} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Change password'}</button>
      </form>
    </CardBody></Card>
    <Card><CardHeader>Sign-in email</CardHeader><CardBody>
      {!account ? <p role="status" className="text-sm text-cui-muted">Loading account security...</p> : <div className="max-w-lg space-y-3">
        <p className="break-all text-sm">{account.email} · {account.email_verified ? 'Verified' : 'Not verified'}</p>
        {activeChange ? <p className="text-sm">{change.new_email} · {change.status === 'pending' ? 'Awaiting owner approval' : 'Approved; verification required'}</p> : null}
        {change && !activeChange ? <p className="text-sm text-cui-muted">Previous request: {Date.parse(change.expires_at) <= Date.now() && change.status !== 'completed' ? 'Expired' : change.status}</p> : null}
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void act('/api/account/email', { action: 'request', email, current_password: current }); }}>
          <label className="block text-sm font-semibold">New sign-in email<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold">Confirm current password<input required type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} className={input} /></label>
          <button disabled={busy || !account.active} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{account.can_change_email ? 'Request verified email change' : 'Request owner approval'}</button>
        </form>
        {activeChange ? <div className="flex flex-wrap gap-3">
          {change.status === 'approved' ? <button type="button" disabled={busy || !current} onClick={() => void act('/api/account/email', { action: 'verify', current_password: current })} className="rounded border border-cui-primary px-3 py-2 text-sm font-semibold text-cui-primary disabled:opacity-50">Send verification links</button> : null}
          <button type="button" disabled={busy || !current} onClick={() => void act('/api/account/email', { action: 'cancel', current_password: current })} className="text-sm text-cui-danger underline disabled:opacity-50">Cancel request</button>
        </div> : null}
      </div>}
    </CardBody></Card>
  </div>;
}
