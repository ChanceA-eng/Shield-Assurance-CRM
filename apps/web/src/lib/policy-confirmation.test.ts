import { describe, expect, it } from 'vitest';
import { policyConfirmation } from './policy-confirmation';

const valid = { confirmed_on: '2026-01-01', reference: ' Portal ABC ', file_id: null, attested: true };
describe('carrier evidence contracts', () => {
  it('requires a reference or document, date and explicit attestation', () => {
    expect(policyConfirmation(valid)).toMatchObject({ reference: 'Portal ABC', attested: true });
    expect(policyConfirmation({ ...valid, reference: '', file_id: '039d0052-4587-4bb9-9f0b-d5b92407f58c' }).file_id).toBeTruthy();
  });
  it.each([undefined, {}, { ...valid, attested: false }, { ...valid, reference: '' }, { ...valid, confirmed_on: '2026-02-30' },
    { ...valid, confirmed_on: '2999-01-01' }, { ...valid, file_id: 'invalid' }, { ...valid, reference: 'x'.repeat(501) }])('rejects invalid evidence %#', (value) => {
    expect(() => policyConfirmation(value)).toThrow();
  });
});
