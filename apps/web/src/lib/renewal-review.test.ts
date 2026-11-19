import { describe, expect, it } from 'vitest';
import { canTransitionRenewalReview, isRenewalCalendarDate, isRenewalReviewStatus, renewalTermDate } from './renewal-review';

describe('renewal review workflow', () => {
  it('allows an explicit outcome and reopen while keeping terminal decisions stable', () => {
    expect(canTransitionRenewalReview('in_review', 'remarketing')).toBe(true);
    expect(canTransitionRenewalReview('remarketing', 'renewed')).toBe(true);
    expect(canTransitionRenewalReview('renewed', 'non_renewed')).toBe(false);
    expect(canTransitionRenewalReview('renewed', 'in_review')).toBe(true);
  });

  it('accepts only defined statuses and real calendar dates', () => {
    expect(isRenewalReviewStatus('non_renewed')).toBe(true);
    expect(isRenewalReviewStatus('automatic')).toBe(false);
    expect(isRenewalCalendarDate('2026-03-01')).toBe(true);
    expect(isRenewalCalendarDate('2026-02-31')).toBe(false);
  });

  it('uses the renewal date and falls back to expiration date for the policy term', () => {
    expect(renewalTermDate('2026-12-01', '2026-11-30')).toBe('2026-12-01');
    expect(renewalTermDate(null, '2026-11-30')).toBe('2026-11-30');
    expect(renewalTermDate(null, null)).toBeNull();
  });
});
