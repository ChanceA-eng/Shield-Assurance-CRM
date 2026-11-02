'use client';

import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import PolicyQuoteProvenance from './PolicyQuoteProvenance';
import PolicyTermDetails from './PolicyTermDetails';

export default function AccountContextRecord({ clientId, type, id }: { clientId: string; type: string; id: string }): JSX.Element {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRecord(null); setError('');
    void workspaceFetch<{ record: Record<string, unknown> }>(`/api/clients/${clientId}/context?${new URLSearchParams({ type, id })}`)
      .then((result) => { if (active) setRecord(result.record); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Record could not load.'); });
    return () => { active = false; };
  }, [clientId, type, id]);
  return <Card className="mb-4 border-cui-primary/50"><CardHeader>Selected {type} record</CardHeader><CardBody>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : !record ? <p role="status" className="text-sm text-cui-muted">Loading exact record...</p> : type === 'policy'
      ? <PolicyTermDetails record={record} clientId={clientId} />
      : <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(record).filter(([key, value]) => value !== null && typeof value !== 'object' && !['id', 'client_id', 'account_id', 'policy_id'].includes(key)).map(([key, value]) => <div key={key}><dt className="text-xs font-semibold uppercase text-cui-muted">{key.replace(/_/g, ' ')}</dt><dd className="mt-1 break-words text-cui-text">{String(value)}</dd></div>)}
    </dl>}
    {type === 'policy' && record ? <PolicyQuoteProvenance snapshot={record.quote_snapshot} /> : null}
  </CardBody></Card>;
}
