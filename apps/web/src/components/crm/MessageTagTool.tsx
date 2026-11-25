'use client';

import { useRef, useState } from 'react';
import { SALES_FIELDS, type SalesFacts, type SalesField } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import ConversationTool from './ConversationTool';

export default function MessageTagTool({ conversation, disabled, onInsert }: {
  conversation: string; disabled: boolean; onInsert: (value: string) => void;
}): JSX.Element {
  const [facts, setFacts] = useState<SalesFacts>({});
  const [field, setField] = useState<SalesField>('contact_name');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const load = (): void => {
    const request = ++version.current;
    setLoading(true); setError(''); setFacts({}); setValue('');
    void workspaceFetch<{ facts: SalesFacts }>(`/api/sales-templates?conversation=${encodeURIComponent(conversation)}`)
      .then((result) => {
        if (request !== version.current) return;
        setFacts(result.facts); setValue(result.facts[field] ?? '');
      })
      .catch((failure: unknown) => {
        if (request === version.current) setError(failure instanceof Error ? failure.message : 'Details could not be loaded.');
      })
      .finally(() => { if (request === version.current) setLoading(false); });
  };
  return <ConversationTool label="Tags" title="Insert a detail" disabled={disabled} onOpen={load}>
    {(close) => <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-cui-danger">{error} <button type="button" className="underline" onClick={load}>Retry</button></p> : null}
      <label className="block text-xs font-semibold">Detail
        <select className="crm-input mt-1" value={field} disabled={loading} onChange={(event) => {
          const next = SALES_FIELDS.find((item) => item === event.target.value);
          if (next) { setField(next); setValue(facts[next] ?? ''); }
        }}>{SALES_FIELDS.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select>
      </label>
      <label className="block text-xs font-semibold">Value
        <input className="crm-input mt-1" value={value} maxLength={2000} disabled={loading}
          onChange={(event) => setValue(event.target.value)} />
      </label>
      <p className="text-xs text-cui-muted">Review or enter the value before inserting it into your message.</p>
      <button type="button" className="crm-button-primary" disabled={loading || Boolean(error) || !value.trim() || /\{\{|\}\}/.test(value)}
        onClick={() => { onInsert(value.trim()); close(); }}>Insert detail</button>
    </div>}
  </ConversationTool>;
}
