import { isRecord } from '../../lib/workspace-validation';

export default function PolicyQuoteProvenance({ snapshot }: { snapshot: unknown }): JSX.Element | null {
  if (!isRecord(snapshot)) return null;
  return <details className="mt-2 rounded border border-cui-border p-2 text-xs">
    <summary className="cursor-pointer font-semibold text-cui-primary">Original quote at placement</summary>
    <p className="mt-2 text-cui-muted">Historical quoted terms, not a confirmed coverage schedule. Later quote edits do not change this snapshot.</p>
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
      {(['carrier', 'line_of_business', 'premium', 'effective_date', 'expiration_date', 'limits', 'deductibles', 'notes'] as const)
        .map((key) => typeof snapshot[key] === 'string' || typeof snapshot[key] === 'number'
          ? <div key={key}><dt className="font-semibold capitalize">{key.replaceAll('_', ' ')}</dt><dd className="whitespace-pre-wrap">{String(snapshot[key]) || '--'}</dd></div> : null)}
    </dl>
  </details>;
}
