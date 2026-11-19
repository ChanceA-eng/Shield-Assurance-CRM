'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useWorkspaceNavigation } from '../../context/WorkspaceNavigationContext';

interface GmailConnection {
  email: string;
  status: string;
  sync_enabled: boolean;
  last_error: string | null;
}

interface GmailStatus {
  connection: GmailConnection | null;
}

export default function PersonalGmailConnectionSettings(): JSX.Element {
  const { confirmLeave } = useWorkspaceNavigation();
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await workspaceFetch<GmailStatus>('/api/gmail');
      setConnection(result.connection);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Gmail connection status is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await workspaceFetch<{ url: string }>('/api/gmail/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'send_only', accept_send_only: true }),
      });
      if (confirmLeave()) window.location.assign(result.url);
      else setBusy(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Gmail authorization could not be started.');
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await workspaceFetch<{ message: string }>('/api/gmail', { method: 'DELETE' });
      setNotice(result.message);
      setAccepted(false);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Gmail could not be disconnected.');
    } finally {
      setBusy(false);
    }
  };

  return <Card>
    <CardHeader actions={<button type="button" onClick={() => void load()} disabled={loading || busy}
      className="text-sm font-semibold text-cui-primary disabled:opacity-50">{loading ? 'Checking...' : 'Refresh status'}</button>}>
      Personal Gmail sending
    </CardHeader>
    <CardBody className="space-y-4">
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
      {connection && connection.sync_enabled ? <>
        <p className="text-sm"><strong>{connection.email}</strong> · {connection.status}</p>
        <p className="text-sm text-cui-muted">This mailbox has shared CRM conversation sync enabled. Manage it in the team Gmail settings.</p>
        {connection.last_error ? <p role="alert" className="text-sm text-cui-danger">{connection.last_error}</p> : null}
        {connection.status !== 'disconnected' ? <button type="button" onClick={() => void disconnect()} disabled={busy}
          className="rounded border border-cui-danger px-3 py-1.5 text-sm font-semibold text-cui-danger disabled:opacity-50">
          {busy ? 'Disconnecting...' : 'Disconnect Gmail'}
        </button> : null}
      </> : connection && connection.status !== 'disconnected' ? <>
        <p className="text-sm"><strong>{connection.email}</strong> · {connection.status}</p>
        <p className="text-sm text-cui-muted">Send-only access: the CRM can send messages you initiate, but cannot read or sync your mailbox.</p>
        {connection.last_error ? <p role="alert" className="text-sm text-cui-danger">{connection.last_error}</p> : null}
        {connection.status !== 'connected' ? <button type="button" onClick={() => void connect()} disabled={busy}
          className="mr-2 rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Connecting...' : 'Reconnect Gmail'}
        </button> : null}
        <button type="button" onClick={() => void disconnect()} disabled={busy}
          className="rounded border border-cui-danger px-3 py-1.5 text-sm font-semibold text-cui-danger disabled:opacity-50">
          {busy ? 'Disconnecting...' : 'Disconnect Gmail'}
        </button>
      </> : loading ? <p className="text-sm text-cui-muted">Checking Gmail connection...</p> : <div className="space-y-3">
        <p className="text-sm text-cui-muted">Connect your Google mailbox to send human-written one-to-one follow-ups from its Sent folder. The CRM will not read or sync your mailbox.</p>
        <label className="flex items-start gap-2 text-sm text-cui-text">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          I authorize the CRM to send messages I initiate through this Google account using send-only access.
        </label>
        <button type="button" onClick={() => void connect()} disabled={!accepted || busy || !!error}
          className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Connecting...' : 'Connect Gmail'}
        </button>
      </div>}
    </CardBody>
  </Card>;
}
