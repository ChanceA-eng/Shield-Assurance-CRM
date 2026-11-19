import { describe, expect, it } from 'vitest';
import { canTransitionCertificateStatus, isCalendarDate, isCertificateStatus } from './certificate-lifecycle';

describe('certificate lifecycle', () => {
  it('requires review and a private document before delivery can be reported', () => {
    expect(canTransitionCertificateStatus('requested', 'in_review')).toBe(true);
    expect(canTransitionCertificateStatus('requested', 'issued')).toBe(false);
    expect(canTransitionCertificateStatus('in_review', 'issued')).toBe(true);
    expect(canTransitionCertificateStatus('issued', 'delivery_reported')).toBe(true);
    expect(canTransitionCertificateStatus('delivery_reported', 'issued')).toBe(false);
  });

  it('preserves legacy values without accepting them as new lifecycle statuses', () => {
    expect(isCertificateStatus('requested')).toBe(true);
    expect(isCertificateStatus('legacy-imported')).toBe(false);
    expect(canTransitionCertificateStatus('legacy-imported', 'issued')).toBe(false);
    expect(canTransitionCertificateStatus('legacy-imported', 'legacy-imported')).toBe(true);
  });

  it('accepts only real ISO calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('26-02-28')).toBe(false);
  });
});
