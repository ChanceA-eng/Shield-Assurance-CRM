import Link from 'next/link';
import { isRecord } from '../../lib/workspace-validation';

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function date(value: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : 'Invalid date';
}

function priorTerm(record: Record<string, unknown>, clientId: string): JSX.Element | null {
  const previous = record.related_prior_term;
  if (!isRecord(previous)) return null;
  const id = typeof previous.id === 'string' ? previous.id : null;
  if (!id) return null;
  const number = typeof previous.policy_number === 'string' ? previous.policy_number : 'Policy term';
  return <div className="sm:col-span-2"><dt className="text-xs font-semibold text-cui-muted">Previous policy term</dt>
    <dd><Link className="font-semibold text-cui-primary underline" href={`/clients/${clientId}?context_type=policy&context_id=${encodeURIComponent(id)}`}>
      {number} · {date(typeof previous.effective_date === 'string' ? previous.effective_date : null)} – {date(typeof previous.expiration_date === 'string' ? previous.expiration_date : null)}
    </Link></dd></div>;
}

export default function PolicyTermDetails({ record, clientId }: { record: Record<string, unknown>; clientId: string }): JSX.Element {
  const premium = typeof record.premium === 'number' || typeof record.premium === 'string' ? Number(record.premium) : Number.NaN;
  const amount = Number.isFinite(premium)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(premium)
    : 'Not recorded';
  const fields: Array<[string, string]> = [
    ['Insured', text(record, 'insured_name') ?? 'Not recorded'],
    ['Carrier', text(record, 'carrier') ?? 'Not recorded'],
    ['Line of business', [text(record, 'line_of_business'), text(record, 'sub_type')].filter(Boolean).join(' · ') || 'Not recorded'],
    ['Policy number', text(record, 'policy_number') ?? 'Not recorded'],
    ['Status', text(record, 'status') ?? 'Not recorded'],
    ['Premium', amount],
    ['Effective date', date(text(record, 'effective_date'))],
    ['Renewal date', date(text(record, 'renewal_date'))],
    ['Expiration date', date(text(record, 'expiration_date'))],
    ['Billing type', text(record, 'billing_type') ?? 'Not recorded'],
    ['Recorded source', text(record, 'source') ?? 'Not recorded'],
  ];
  const schedule = Array.isArray(record.insured_asset_schedule) ? record.insured_asset_schedule
    .filter(isRecord) : [];
  return <section aria-label="Policy term details" className="mb-4 rounded-lg border border-cui-border bg-cui-body/40 p-4">
    <h3 className="mb-3 text-sm font-semibold text-cui-text">Policy term</h3>
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase text-cui-muted">{label}</dt>
        <dd className="mt-1 break-words text-cui-text">{value}</dd></div>)}
      {priorTerm(record, clientId)}
      <div className="sm:col-span-2"><dt className="text-xs font-semibold text-cui-muted">Next term</dt>
        <dd><Link className="font-semibold text-cui-primary underline"
          href={`/policies?account_id=${encodeURIComponent(clientId)}&renew_from_id=${encodeURIComponent(String(record.id))}`}>
          Start renewal from this term
        </Link></dd></div>
      {typeof record.prior_policy_id === 'string' && !isRecord(record.related_prior_term)
        ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-cui-muted">Previous policy term</dt>
          <dd className="text-sm text-cui-muted">The linked term is not available on this account.</dd></div> : null}
    </dl>
    <section aria-label="Confirmed insured asset schedule" className="mt-4 border-t border-cui-border pt-3">
      <h4 className="text-sm font-semibold text-cui-text">Insured asset schedule</h4>
      <p className="mt-1 text-xs text-cui-muted">A placement-time snapshot of assets explicitly selected for this policy term. This is CRM recordkeeping, not proof of carrier coverage.</p>
      {schedule.length === 0 ? <p className="mt-2 text-sm text-cui-muted">No assets were selected for this term.</p> : <ul className="mt-2 space-y-2">
        {schedule.map((entry) => {
          const asset = isRecord(entry.snapshot) ? entry.snapshot : {};
          const metadata = isRecord(asset.metadata) ? asset.metadata : {};
          const details = isRecord(metadata.details) ? metadata.details : {};
          return <li key={String(entry.id)} className="rounded border border-cui-border bg-white p-3">
            <p className="font-semibold">{text(asset, 'title') ?? 'Untitled asset'} · {text(asset, 'asset_type') ?? 'Asset'}</p>
            {Object.entries(details).filter(([, value]) => typeof value === 'string' && value.trim()).length
              ? <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                {Object.entries(details).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) =>
                  <div key={key}><dt className="capitalize text-cui-muted">{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}
              </dl> : null}
          </li>;
        })}
      </ul>}
    </section>
  </section>;
}
