export const POLICY_SERVICE_REQUEST_TYPES = [
  'address_change',
  'name_change',
  'vehicle_addition',
  'vehicle_removal',
  'property_addition',
  'property_removal',
  'endorsement',
  'certificate',
  'cancellation',
  'rewrite',
  'other',
] as const;

export const POLICY_SERVICE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'waiting_on_carrier',
  'waiting_on_client',
  'confirmed',
  'closed',
  'cancelled',
  'reopened',
] as const;

export type PolicyServiceRequestType = (typeof POLICY_SERVICE_REQUEST_TYPES)[number];
export type PolicyServiceRequestStatus = (typeof POLICY_SERVICE_REQUEST_STATUSES)[number];

const TRANSITIONS: Record<string, readonly PolicyServiceRequestStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['waiting_on_carrier', 'waiting_on_client', 'confirmed', 'cancelled'],
  waiting_on_carrier: ['waiting_on_client', 'confirmed', 'cancelled'],
  waiting_on_client: ['waiting_on_carrier', 'confirmed', 'cancelled'],
  confirmed: ['closed', 'reopened'],
  closed: ['reopened'],
  cancelled: ['reopened'],
  reopened: ['submitted', 'waiting_on_carrier', 'waiting_on_client', 'confirmed', 'cancelled'],
  processed: ['reopened'],
};

export function isPolicyServiceRequestType(value: unknown): value is PolicyServiceRequestType {
  return typeof value === 'string' && POLICY_SERVICE_REQUEST_TYPES.some((item) => item === value);
}

export function isPolicyServiceRequestStatus(value: unknown): value is PolicyServiceRequestStatus {
  return typeof value === 'string' && POLICY_SERVICE_REQUEST_STATUSES.some((item) => item === value);
}

export function canTransitionPolicyServiceRequest(
  current: string,
  next: PolicyServiceRequestStatus,
): boolean {
  return TRANSITIONS[current]?.includes(next) ?? false;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
