'use client';

import { useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

export default function EmailPermissionSettings(): JSX.Element {
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <Card><CardHeader>Marketing permission</CardHeader><CardBody>
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      setBusy(true); setNotice(null); setError(null);
      void workspaceFetch<{ message: string }>('/api/email/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, source, granted }),
      }).then((result) => setNotice(result.message))
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Permission could not be saved. Please try again.'))
        .finally(() => setBusy(false));
    }}>
      <label className="block text-sm font-semibold">Recipient email
        <input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border border-cui-border px-3 py-2" />
      </label>
      <div>
        <label htmlFor="email-marketing-permission" className="block text-sm font-semibold">Permission</label>
        <select id="email-marketing-permission" value={granted ? 'yes' : 'no'} onChange={(event) => setGranted(event.target.value === 'yes')} className="mt-1 w-full rounded border border-cui-border px-3 py-2">
          <option value="no">Stop promotional emails</option><option value="yes">Recipient explicitly agreed to marketing</option>
        </select>
      </div>
      <label className="block text-sm font-semibold">How and when was permission given or withdrawn?
        <textarea required minLength={10} maxLength={1000} rows={3} value={source} onChange={(event) => setSource(event.target.value)} className="mt-1 w-full rounded border border-cui-border px-3 py-2" />
      </label>
      <button disabled={busy} className="crm-button-primary">{busy ? 'Saving...' : 'Save permission'}</button>
      {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    </form>
  </CardBody></Card>;
}
