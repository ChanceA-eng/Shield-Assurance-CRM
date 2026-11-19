import { describe, expect, it } from 'vitest';
import { canTransitionClaimStatus, claimAmount } from './claim-lifecycle';

describe('claim lifecycle', () => {
  it('requires closed claims to be explicitly reopened before work resumes', () => {
    expect(canTransitionClaimStatus('open', 'in_review')).toBe(true);
    expect(canTransitionClaimStatus('in_review', 'closed')).toBe(true);
    expect(canTransitionClaimStatus('closed', 'reopened')).toBe(true);
    expect(canTransitionClaimStatus('closed', 'in_review')).toBe(false);
    expect(canTransitionClaimStatus('legacy_status', 'legacy_status')).toBe(true);
  });

  it('accepts only non-negative finite reserve and payout amounts', () => {
    expect(claimAmount('1250.50', 'Reserve')).toBe(1250.5);
    expect(claimAmount(null, 'Reserve')).toBeNull();
    expect(() => claimAmount('bad', 'Reserve')).toThrow('Reserve must be a non-negative number.');
    expect(() => claimAmount(-1, 'Payout')).toThrow('Payout must be a non-negative number.');
  });
});
