export type RenewalReviewStatus = 'in_review' | 'remarketing' | 'retained' | 'renewed' | 'non_renewed' | 'cancelled';

const RENEWAL_REVIEW_TRANSITIONS: Record<RenewalReviewStatus, readonly RenewalReviewStatus[]> = {
  in_review: ['in_review', 'remarketing', 'retained', 'renewed', 'non_renewed', 'cancelled'],
  remarketing: ['remarketing', 'in_review', 'retained', 'renewed', 'non_renewed', 'cancelled'],
  retained: ['retained', 'in_review'],
  renewed: ['renewed', 'in_review'],
  non_renewed: ['non_renewed', 'in_review'],
  cancelled: ['cancelled', 'in_review'],
};

export function isRenewalReviewStatus(value: unknown): value is RenewalReviewStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RENEWAL_REVIEW_TRANSITIONS, value);
}

export function canTransitionRenewalReview(current: string, next: RenewalReviewStatus): boolean {
  return isRenewalReviewStatus(current) && RENEWAL_REVIEW_TRANSITIONS[current].includes(next);
}

export function isRenewalCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function renewalTermDate(renewalDate: string | null, expirationDate: string | null): string | null {
  return renewalDate ?? expirationDate;
}
