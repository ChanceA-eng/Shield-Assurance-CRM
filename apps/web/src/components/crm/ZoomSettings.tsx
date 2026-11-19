'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';

interface ZoomStatus { connection: { email: string; status: string; last_error?: string | null } | null; configured: boolean }
export default function ZoomSettings(): JSX.Element {
  const [status, setStatus] = useState<ZoomStatus | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStatus(await workspaceFetch<ZoomStatus>('/api/zoom')); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Zoom status could not be checked.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('zoom') === 'connected') setNotice('Zoom connected.');
    void load();
  }, [load]);
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const { url } = await workspaceFetch<{ url: string }>('/api/zoom/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      window.location.assign(url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Zoom could not be connected.'); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Zoom from the CRM? Existing Zoom meetings remain; reconnect to update or cancel them from here.')) return;
    setBusy(true); setError('');
    try {
      const result = await workspaceFetch<{ message: string }>('/api/zoom', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      setNotice(result.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Zoom could not be disconnected.'); }
    finally { setBusy(false); }
  };
  return <Card>
    <CardHeader actions={<button type="button" disabled={busy || loading} onClick={() => void load()} className="text-sm font-semibold text-cui-primary disabled:opacity-50">Refresh Zoom status</button>}>Zoom</CardHeader>
    <CardBody className="space-y-3">
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-cui-success">{notice}</p> : null}
      {loading ? <p className="text-sm text-cui-muted">Checking Zoom...</p>
        : status?.connection ? <p className="text-sm">{status.connection.email} - {status.connection.status}</p>
        : <p className="text-sm">{status?.configured ? 'Not connected' : 'Zoom connection is not enabled yet.'}</p>}
      {status?.connection?.last_error ? <p role="alert" className="text-sm text-cui-danger">{status.connection.last_error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!loading && status?.configured ? <button type="button" disabled={busy || Boolean(error)} onClick={() => void connect()} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Connecting...' : status.connection ? 'Reconnect Zoom' : 'Connect Zoom'}
        </button> : null}
        {status?.connection?.status === 'connected' ? <button type="button" disabled={busy} onClick={() => void disconnect()} className="rounded border border-cui-danger px-3 py-2 text-sm font-semibold text-cui-danger disabled:opacity-50">Disconnect Zoom</button> : null}
      </div>
    </CardBody>
  </Card>;
}
