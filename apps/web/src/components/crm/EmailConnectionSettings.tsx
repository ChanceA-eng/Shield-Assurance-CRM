'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailConnectionStatus } from '../../lib/email-setup';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import AskRashi from './AskRashi';

export default function EmailConnectionSettings(): JSX.Element {
  const [status, setStatus] = useState<EmailConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStatus(await workspaceFetch<EmailConnectionStatus>('/api/settings/email')); }
    catch {
      setStatus(null);
      setError('Email status could not be checked. Refresh to retry, or contact support.');
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const sendTest = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await workspaceFetch<{ message: string }>('/api/settings/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId.current }),
      });
      setNotice(result.message); requestId.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The test was not confirmed. Refresh status before trying again.');
      setUncertain(true);
    } finally { setBusy(false); }
  };
  const ready = Boolean(status?.sendingEnabled && status.domainStatus === 'verified' && !status.issues.length);
  return <Card><CardHeader actions={<button type="button" disabled={loading || busy} onClick={() => void load()} className="text-sm font-semibold text-cui-primary disabled:opacity-50">{loading ? 'Checking...' : 'Refresh status'}</button>}>Email</CardHeader><CardBody className="space-y-4">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
    {status ? <>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">From</dt><dd className="break-all">{status.sender || 'Not set'}</dd>
        <dt className="font-semibold">Reply-to</dt><dd className="break-all">{status.replyTo || 'Not set'}</dd>
        <dt className="font-semibold">Domain</dt><dd>{status.domainStatus === 'verified' ? <span className="font-semibold text-green-800">Verified</span> : 'Not verified'}</dd>
        <dt className="font-semibold">Sending</dt><dd className={ready ? 'font-semibold text-green-800' : 'font-semibold text-cui-danger'}>{ready ? 'Enabled' : 'Unavailable'}</dd>
        <dt className="font-semibold">Sequence replies</dt><dd className={status.replyReady ? 'text-green-800' : 'text-amber-800'}>{status.replyReady ? 'Verified' : status.inboundAddress ? 'Reply test required' : 'Unavailable'}</dd>
        <dt className="font-semibold">Open detection</dt><dd>{status.openTracking && status.trackingStatus === 'verified' ? 'Enabled' : status.openTracking ? 'Not yet verified' : 'Not enabled'}</dd>
        {status.latestTest ? <><dt className="font-semibold">Last test</dt><dd className="capitalize">{status.latestTest.delivery}</dd></> : null}
      </dl>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || loading || !ready || uncertain || status.latestTest?.delivery === 'Unconfirmed - do not resend'}
          onClick={() => void sendTest()} className="crm-button-primary">
          {busy ? 'Sending test...' : 'Send test & verify replies'}
        </button>
        <AskRashi topic="email" label={status.issues.length ? 'Resolve email setup with Rashi' : 'Email help'}
          detail={status.issues.length ? status.issues.join('\n') : undefined} />
      </div>
      {!status.replyReady && ready && status.inboundAddress ? <div className="space-y-2 rounded border border-cui-border p-3 text-sm">
        <p>Reply to the test email from your mailbox, then select <strong>Refresh status</strong>.</p>
        <p>{status.replyTo.toLowerCase() === status.inboundAddress.toLowerCase()
          ? 'New replies go directly into the CRM:'
          : 'Forward a copy from your reply-to mailbox to:'}</p>
        <div className="flex flex-wrap items-center gap-2"><code className="break-all">{status.inboundAddress}</code>
          {status.inboundAddress ? <button type="button" className="font-semibold text-cui-primary underline" onClick={() => {
            void navigator.clipboard.writeText(status.inboundAddress).then(() => setNotice('Receiving address copied.'))
              .catch(() => setError('Copy failed. Select and copy the receiving address manually.'));
          }}>Copy address</button> : null}
        </div>
        {status.replyTo.toLowerCase() !== status.inboundAddress.toLowerCase() ? <p className="text-xs text-cui-muted">Keep the original sender.</p> : null}
      </div> : null}
      {uncertain ? <p role="alert" className="text-sm text-cui-danger">Test result needs review. Refresh status; do not send another copy of an unconfirmed test.</p> : null}
    </> : loading ? <p className="text-sm text-cui-muted">Checking email...</p> : null}
  </CardBody></Card>;
}
