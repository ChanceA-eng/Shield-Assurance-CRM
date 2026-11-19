export type RenewalEvidenceClass = 'vendor_reported' | 'predicted' | 'confirmed' | 'unknown';

export interface RenewalEvidence {
  type: string;
  date: string;
  carrier: string | null;
  broker: string | null;
  evidence_class: RenewalEvidenceClass;
  precision: 'date' | 'month';
  source_field: string | null;
  confirmed_by?: string;
  confirmed_on?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validEvidenceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Legacy GL/auto imports are predictions; imports never establish confirmation. */
export function readRenewalEvidence(value: unknown): RenewalEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).flatMap((row) => {
    if (typeof row.type !== 'string' || !row.type.trim() || !validEvidenceDate(row.date)) return [];
    const confirmed = row.evidence_class === 'confirmed' && typeof row.confirmed_by === 'string'
      && Boolean(row.confirmed_by.trim()) && validEvidenceDate(row.confirmed_on);
    const predicted = row.evidence_class === 'predicted' || (!confirmed && row.evidence_class !== 'vendor_reported'
      && row.evidence_class !== 'unknown' && (/general liability|commercial auto/i.test(row.type)
        || /prediction/i.test(String(row.source_field ?? ''))));
    const evidence_class: RenewalEvidenceClass = confirmed ? 'confirmed' : predicted ? 'predicted'
      : row.evidence_class === 'unknown' || row.evidence_class === 'confirmed' ? 'unknown' : 'vendor_reported';
    return [{
      type: row.type.trim(), date: row.date,
      carrier: typeof row.carrier === 'string' ? row.carrier : null,
      broker: typeof row.broker === 'string' ? row.broker : null,
      evidence_class, precision: predicted || row.precision === 'month' ? 'month' as const : 'date' as const,
      source_field: typeof row.source_field === 'string' ? row.source_field : null,
      ...(confirmed ? { confirmed_by: String(row.confirmed_by), confirmed_on: String(row.confirmed_on) } : {}),
    }];
  });
}

export function renewalEvidenceLabel(renewal: RenewalEvidence): string {
  const date = renewal.precision === 'month' ? renewal.date.slice(0, 7) : renewal.date;
  const unit = renewal.precision === 'month' ? 'month' : 'date';
  const label = renewal.evidence_class === 'predicted' ? 'Predicted month'
    : renewal.evidence_class === 'confirmed' ? `Confirmed ${unit}`
      : renewal.evidence_class === 'unknown' ? 'Unverified timing' : `Vendor-reported ${unit}`;
  return `${label}: ${date}`;
}
