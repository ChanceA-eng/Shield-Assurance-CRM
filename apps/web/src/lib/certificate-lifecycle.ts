export type CertificateStatus =
  | 'requested'
  | 'in_review'
  | 'issued'
  | 'delivery_reported'
  | 'declined'
  | 'cancelled';

const CERTIFICATE_STATUS_TRANSITIONS: Record<CertificateStatus, readonly CertificateStatus[]> = {
  requested: ['requested', 'in_review', 'cancelled'],
  in_review: ['in_review', 'requested', 'issued', 'declined', 'cancelled'],
  issued: ['issued', 'delivery_reported'],
  delivery_reported: ['delivery_reported'],
  declined: ['declined', 'requested', 'cancelled'],
  cancelled: ['cancelled', 'requested'],
};

export function isCertificateStatus(value: unknown): value is CertificateStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CERTIFICATE_STATUS_TRANSITIONS, value);
}

export function canTransitionCertificateStatus(current: string, next: string): boolean {
  if (!isCertificateStatus(current)) return current === next;
  return isCertificateStatus(next) && CERTIFICATE_STATUS_TRANSITIONS[current].includes(next);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
