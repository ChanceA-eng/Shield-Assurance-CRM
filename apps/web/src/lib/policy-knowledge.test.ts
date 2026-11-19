import { describe, expect, it } from 'vitest';
import { parsePolicyKnowledge, assertDeidentifiedPolicyKnowledge } from './policy-knowledge';

const values = {
  account_id: 'd0b0cd9e-31fb-4a1e-99ab-cd33220adca5',
  carrier: 'Example Carrier', form_number: 'CG 00 01', edition: '04 13', jurisdiction: 'Arizona',
  line_of_business: 'General liability',
  wording: 'This insurance does not apply to bodily injury expected or intended from the standpoint of the insured.',
  privacy_confirmed: true, rights_confirmed: true,
};
describe('policy wording review boundary', () => {
  it('accepts explicit reviewed context and rejects missing privacy or reuse permission', () => {
    expect(parsePolicyKnowledge(values).wording).toBe(values.wording);
    for (const key of ['account_id', 'carrier', 'edition', 'privacy_confirmed', 'rights_confirmed']) {
      expect(() => parsePolicyKnowledge({ ...values, [key]: null })).toThrow();
    }
    expect(() => parsePolicyKnowledge({ ...values, wording: 'too short' })).toThrow();
    expect(() => parsePolicyKnowledge({ ...values, wording: 'a'.repeat(6001) })).toThrow();
  });
  it.each([
    'Contact jane@example.invalid for further information.',
    'Phone: (520) 555-0100', 'SSN: 123-45-6789',
    'Vehicle: 1HGCM82633A004352', 'Location: 123 Main Street',
    'Policy number: QA-123', 'Premium: 2500',
  ])('blocks identifying or account-specific wording: %s', (privateText) => {
    const parsed = parsePolicyKnowledge({ ...values, wording: `${values.wording}\n${privateText}` });
    expect(() => assertDeidentifiedPolicyKnowledge(parsed, [])).toThrow('Possible customer');
  });
  it('checks private account identifiers in metadata as well as wording', () => {
    expect(() => assertDeidentifiedPolicyKnowledge(parsePolicyKnowledge(values), ['Different Account'])).not.toThrow();
    expect(() => assertDeidentifiedPolicyKnowledge(parsePolicyKnowledge({ ...values, carrier: 'Synthetic Review LLC' }), ['Synthetic Review LLC'])).toThrow('Possible customer');
    expect(() => assertDeidentifiedPolicyKnowledge(parsePolicyKnowledge({ ...values, wording: `${values.wording} Applies to qa 123.` }), ['QA-123'])).toThrow('Possible customer');
  });
});
