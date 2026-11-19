'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useWorkspaceNavigation } from '../../context/WorkspaceNavigationContext';

interface CalendarConnection { email: string; status: string }

export default function GoogleCalendarSettings(): JSX.Element {
  const { confirmLeave } = useWorkspaceNavigation();
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setConnection((await workspaceFetch<{ connection: CalendarConnection | null }>('/api/google-calendar')).connection); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Calendar connection could not be checked.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('google_calendar') === 'connected') setNotice('Google Calendar connected.');
    void load();
  }, [load]);
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const { url } = await workspaceFetch<{ url: string }>('/api/google-calendar/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (confirmLeave()) window.location.assign(url);
      else setBusy(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Google Calendar could not be connected.'); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? Existing appointments remain; future calendar updates and Meet creation will require reconnecting. Gmail sending stays connected.')) return;
    setBusy(true); setError('');
    try {
      const result = await workspaceFetch<{ message: string }>('/api/google-calendar', { method: 'DELETE' });
      setNotice(result.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Calendar could not be disconnected.'); }
    finally { setBusy(false); }
  };
  return <Card>
    <CardHeader actions={<button type="button" disabled={busy || loading} onClick={() => void load()} className="text-sm font-semibold text-cui-primary disabled:opacity-50">Refresh calendar status</button>}>Google Calendar &amp; Meet</CardHeader>
    <CardBody className="space-y-3">
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-cui-success">{notice}</p> : null}
      {loading ? <p className="text-sm text-cui-muted">Checking calendar...</p> : <p className="text-sm">{connection ? `${connection.email} - ${connection.status}` : 'Not connected'}</p>}
      <div className="flex flex-wrap gap-2">
        {!loading && connection?.status !== 'connected' ? <button type="button" disabled={busy || Boolean(error)} onClick={() => void connect()} className="crm-button-primary">{busy ? 'Connecting...' : connection ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button> : null}
        {connection?.status === 'connected' ? <button type="button" disabled={busy} onClick={() => void disconnect()} className="rounded border border-cui-danger px-3 py-2 text-sm font-semibold text-cui-danger disabled:opacity-50">Disconnect calendar</button> : null}
      </div>
    </CardBody>
  </Card>;
}
