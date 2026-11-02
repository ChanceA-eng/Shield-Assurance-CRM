import { describe, expect, it } from 'vitest';
import { quoteFields } from './quote-options';

const fields = { carrier: ' Test carrier ', line_of_business: 'Auto', premium: '1250.55',
  status: 'draft', effective_date: '2026-11-02', expiration_date: '2027-11-02' };
describe('manual quote validation', () => {
  it('normalizes a manual quote without policy or lead mutations', () => {
    expect(quoteFields(fields)).toEqual({ ...fields, carrier: 'Test carrier', premium: 1250.55, notes: '', limits: '', deductibles: '' });
  });
  it.each(['draft','presented','accepted','declined'])('accepts %s as a quote outcome only', (status) => {
    expect(quoteFields({ ...fields, status }).status).toBe(status);
  });
  it.each(['', ' ', null, false, -1, 'invalid', '12.123'])('rejects invalid premium %s', (premium) => {
    expect(() => quoteFields({ ...fields, premium })).toThrow();
  });
  it('rejects invalid dates, reversed terms, missing carrier and unsupported status', () => {
    for (const updates of [{ effective_date: '2026-02-30' }, { expiration_date: '2025-01-01' }, { carrier: '' }, { status: 'bound' }]) {
      expect(() => quoteFields({ ...fields, ...updates })).toThrow();
    }
  });
});
