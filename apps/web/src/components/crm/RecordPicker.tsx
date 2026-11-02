'use client';

import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';

interface Choice { id: string; full_name: string; email?: string | null }

export default function RecordPicker({ type, value, onChange }: {
  type: 'lead' | 'client'; value: string; onChange: (id: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      const url = `/api/${type === 'lead' ? 'leads' : 'clients'}?q=${encodeURIComponent(query)}&limit=100`;
      void workspaceFetch<Choice[]>(url).then((rows) => {
        if (!Array.isArray(rows)) throw new Error('Invalid record search response.');
        if (current) { setChoices(rows); setError(''); }
      }).catch((failure: unknown) => {
        if (current) setError(failure instanceof Error ? failure.message : 'Could not search records.');
      }).finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [type, query]);
  return <div className="space-y-2">
    <input aria-label="Search related record" placeholder={`Search ${type === 'lead' ? 'leads' : 'accounts'} by name`} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded border border-cui-border px-3 py-2 text-sm" />
    <select required aria-label="Related record" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} className="w-full rounded border border-cui-border px-3 py-2 text-sm">
      <option value="">Choose a record</option>
      {value && !choices.some((choice) => choice.id === value) ? <option value={value}>Previously selected record</option> : null}
      {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.full_name}{choice.email ? ` (${choice.email})` : ''}</option>)}
    </select>
    <p className="text-xs text-cui-muted">{loading ? 'Searching...' : 'Up to 100 matching records. Refine the name to find older records.'}</p>
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </div>;
}
