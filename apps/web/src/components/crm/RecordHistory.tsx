'use client';

import { useState } from 'react';
import type { RecordTarget } from '@crm/shared';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { isRecord } from '../../lib/workspace-validation';
import { workspacePages } from '../../lib/workspace-fetch';

interface Entry {
  id: string;
  title: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

function snapshotText(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.content === 'string') return value.content;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const details = isRecord(metadata.details) ? metadata.details : {};
  const lines = Object.entries(details).filter(([, field]) => typeof field === 'string')
    .map(([key, field]) => `${key.replace(/_/g, ' ')}: ${String(field)}`);
  if (typeof value.title === 'string') lines.unshift(value.title);
  if (typeof value.value === 'string' && value.value) lines.push(value.value);
  return lines.join('\n');
}

export default function RecordHistory({ target, itemId, table }: { target: RecordTarget; itemId: string; table: 'interactions' | 'client_assets' }): JSX.Element {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setEntries(await workspacePages<Entry>(`/api/record-activity?record_type=${target.type}&record_id=${target.id}&item_id=${itemId}&table=${table}`, 100, 'page'));
      setError(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load edit history.'); }
    finally { setLoading(false); }
  };
  return (
    <details className="mt-2 text-xs" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
      <summary className="cursor-pointer font-semibold text-cui-primary">View change history</summary>
      {loading ? <p className="mt-2 text-cui-muted">Loading history...</p> : null}
      {error ? <p role="alert" className="mt-2 text-cui-danger">{error}</p> : null}
      {entries?.length === 0 ? <p className="mt-2 text-cui-muted">No recorded edits. Legacy records may predate the audit history.</p> : null}
      {entries?.map((entry) => (
        <div key={entry.id} className="mt-2 rounded border border-cui-border bg-cui-light/40 p-2">
          <p className="font-semibold text-cui-text">{entry.title}</p>
          <p className="text-cui-muted">{formatArizonaDateTime(entry.occurred_at)} AZ{typeof entry.metadata.actor === 'string' ? ` | ${entry.metadata.actor}` : ''}</p>
          {snapshotText(entry.metadata.before) ? <div className="mt-1"><p className="font-semibold text-cui-muted">Before</p><p className="whitespace-pre-wrap text-cui-text">{snapshotText(entry.metadata.before)}</p></div> : null}
          <div className="mt-1"><p className="font-semibold text-cui-muted">{entry.metadata.before ? 'After' : 'Recorded'}</p><p className="whitespace-pre-wrap text-cui-text">{snapshotText(entry.metadata.after)}</p></div>
        </div>
      ))}
    </details>
  );
}
