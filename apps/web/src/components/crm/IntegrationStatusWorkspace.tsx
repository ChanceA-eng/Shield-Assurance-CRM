'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import AskRashi from './AskRashi';

type IntegrationState = 'missing' | 'configured' | 'healthy' | 'failed';
interface Integration {
  id: string;
  name: string;
  state: IntegrationState;
  detail: string;
  connections?: Array<{
    email: string;
    status: string;
    last_sync_at: string | null;
    watch_expires_at: string | null;
    bootstrap_complete: boolean;
  }>;
}
interface IntegrationResponse { integrations: Integration[] }

const stateLabels: Record<IntegrationState, string> = {
  missing: 'Unavailable',
  configured: 'Not yet verified',
  healthy: 'Connected',
  failed: 'Needs attention',
};
const stateStyles: Record<IntegrationState, string> = {
  missing: 'bg-slate-100 text-slate-700',
  configured: 'bg-amber-100 text-amber-900',
  healthy: 'bg-green-100 text-green-900',
  failed: 'bg-rose-100 text-rose-900',
};

function formatSyncDate(value: string | null): string {
  if (!value) return 'Not synced';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Last sync unavailable' : `Last sync ${parsed.toLocaleString()}`;
}

export default function IntegrationStatusWorkspace(): JSX.Element {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await workspaceFetch<IntegrationResponse>('/api/settings/integrations');
      setIntegrations(result.integrations);
    } catch (failure) {
      setIntegrations(null);
      setError(failure instanceof Error ? failure.message : 'Integration status could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader actions={<button type="button" disabled={loading} onClick={() => void load()} className="text-sm font-semibold text-cui-primary disabled:opacity-50">
        {loading ? 'Checking...' : 'Refresh status'}
      </button>}>Integrations</CardHeader>
      <CardBody className="space-y-4">
        {error ? <div role="alert" className="rounded border border-cui-danger/30 bg-cui-danger/5 p-3 text-sm text-cui-danger">
          <p>{error}</p><button type="button" disabled={loading} onClick={() => void load()} className="mt-2 font-semibold underline">Retry status check</button>
        </div> : null}
        {loading && !integrations ? <p role="status" className="text-sm text-cui-muted">Checking integration status...</p> : null}
        {integrations ? <ul className="space-y-3">
          {integrations.map((integration) => (
            <li key={integration.id} className="rounded-lg border border-cui-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-cui-text">{integration.name}</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stateStyles[integration.state]}`}>
                  {stateLabels[integration.state]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
              {integration.id === 'gmail' ? <Link href="/account?tab=signature" className="crm-button mt-3">Manage Gmail</Link> : null}
              {integration.id === 'resend' ? <a href="/settings?tab=email" className="crm-button mt-3">Manage email</a> : null}
              {integration.id === 'openai' && integration.state !== 'missing' ? <Link href="/communication" className="crm-button mt-3">Open conversations</Link> : null}
                <AskRashi topic="integrations" label={`Help with ${integration.name}`}
                  detail={`${integration.name}: ${stateLabels[integration.state]}. ${integration.detail}`} />
              </div>
              {integration.connections?.length ? <ul className="mt-3 divide-y divide-cui-border rounded border border-cui-border">
                {integration.connections.map((connection) => (
                  <li key={connection.email} className="flex flex-wrap justify-between gap-2 p-3 text-xs">
                    <span className="break-all font-semibold text-cui-text">{connection.email}</span>
                    <span className="text-cui-muted">
                      {connection.status === 'connected' && connection.bootstrap_complete ? formatSyncDate(connection.last_sync_at) : connection.status === 'reconnect' ? 'Reconnect required' : connection.status}
                    </span>
                  </li>
                ))}
              </ul> : null}
            </li>
          ))}
        </ul> : null}
      </CardBody>
    </Card>
  );
}
