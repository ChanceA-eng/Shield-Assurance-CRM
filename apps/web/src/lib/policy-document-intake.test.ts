import { describe, expect, it } from 'vitest';
import { reconstructPolicyText, reviewPolicySuggestions, suggestPolicyFields, validateReviewedIntakeFields, validateIntakeFile, INTAKE_MAX_FILE_BYTES } from './policy-document-intake';

describe('on-device policy document intake', () => {
  it('maps common policy aliases and retains policy words inside actual business and carrier names', () => {
    const parsed = suggestPolicyFields([{ page: 1, method: 'text', confidence: null, text: [
      'BUSINESS AUTO COVERAGE FORM', 'Business Name: Synthetic Insurance Company LLC',
      'Insurance Company: Example Mutual Insurance Company', 'Policy #: BA-991177',
      'Premium: $250.00', 'Total Estimated Annual Premium: $2,450.00',
      'DBA: Synthetic Fleet Services', 'NAICS: 484110', 'Business Entity: Limited Liability Company',
    ].join('\n') }]);
    expect(reviewPolicySuggestions([parsed])).toMatchObject({
      full_name: 'Synthetic Insurance Company LLC', carrier: 'Example Mutual Insurance Company',
      policy_number: 'BA-991177', premium: '2450.00', line_of_business: 'Business auto',
      additional_details: 'DBA: Synthetic Fleet Services\nNAICS: 484110\nBusiness Entity: Limited Liability Company',
    });
  });
  it('extracts coverage and deductible columns, multiple vehicles, drivers and property schedules as separate expandable fields', () => {
    const parsed = suggestPolicyFields([{ page: 1, method: 'text', confidence: null, text: [
      'DECLARATIONS', 'Insured: Synthetic Scheduled LLC',
      'COVERAGES                     LIMITS               DEDUCTIBLES        PREMIUM',
      'Bodily Injury Liability        $1,000,000           $0                 $400',
      'Comprehensive                  Actual Cash Value    $500               $100',
      'VEHICLE SCHEDULE', 'YEAR  MAKE  MODEL  VIN',
      '2023  Ford  Transit  1FTBW2CM5PKA00001',
      '2022  Toyota  Camry  4T1G11AK2NU000001',
      'DRIVER SCHEDULE', 'NAME                          DATE OF BIRTH       LICENSE NUMBER',
      'Synthetic Driver One          01/01/1980          A12345678',
      'Synthetic Driver Two          02/02/1981          A99999999',
      'PROPERTY SCHEDULE', 'Location 1: 123 Example Road, Tucson, AZ 85701',
      'Construction: Masonry', 'Occupancy: Warehouse',
      'FORMS AND ENDORSEMENTS', 'Form: CA 00 01 11 20',
      'SSN: 123-45-6789', 'Bank Account: 123456789',
    ].join('\n') }]);
    const fields = reviewPolicySuggestions([parsed]);
    expect(fields.coverage_limits).toBe('Bodily Injury Liability | $1,000,000\nComprehensive | Actual Cash Value');
    expect(fields.deductibles).toBe('Bodily Injury Liability: $0\nComprehensive: $500');
    expect(fields.vehicles).toBe('2023  Ford  Transit  1FTBW2CM5PKA00001\n2022  Toyota  Camry  4T1G11AK2NU000001');
    expect(fields.drivers).toBe('Synthetic Driver One\nSynthetic Driver Two');
    expect(fields.properties).toBe('Location 1: 123 Example Road, Tucson, AZ 85701\nConstruction: Masonry\nOccupancy: Warehouse');
    expect(fields.additional_details).toBe('Form: CA 00 01 11 20');
    expect(JSON.stringify(fields)).not.toMatch(/123-45-6789|123456789|A12345678|1980|A99999999/);
  });
  it('merges supplementary schedules without treating them as conflicts but keeps conflicting core fields unresolved', () => {
    const first = suggestPolicyFields([{ page: 1, method: 'text', confidence: null, text: 'Policy No: BA-123\nTotal Premium: $1,500\nCoverage Limits\nEach Occurrence: $1,000,000' }]);
    const second = suggestPolicyFields([{ page: 2, method: 'text', confidence: null, text: 'Policy No: BA-999\nPremium: $2,500\nCoverage Limits\nGeneral Aggregate: $2,000,000' }]);
    const fields = reviewPolicySuggestions([first, second]);
    expect(fields.policy_number).toBeUndefined();
    expect(fields.premium).toBeUndefined();
    expect(fields.coverage_limits).toBe('Each Occurrence: $1,000,000\nGeneral Aggregate: $2,000,000');
  });
  it('validates persisted review keys and field sizes without silently truncating details', () => {
    expect(validateReviewedIntakeFields({ vehicles: '2023 Ford Transit\n2022 Toyota Camry', full_name: ' Synthetic LLC ' }))
      .toEqual({ vehicles: '2023 Ford Transit\n2022 Toyota Camry', full_name: 'Synthetic LLC' });
    expect(() => validateReviewedIntakeFields({ ssn: 'private' })).toThrow('Unsupported');
    expect(() => validateReviewedIntakeFields({ vehicles: 'x'.repeat(12001) })).toThrow('Vehicles');
    expect(() => validateReviewedIntakeFields({ carrier: 4 })).toThrow('Carrier');
  });
  it('recognizes continuation tables without a repeated schedule title and does not mistake company prose for a carrier', () => {
    const parsed = suggestPolicyFields([{ page: 2, method: 'text', confidence: null, text: [
      'YEAR  MAKE  MODEL  VIN', '2023  Ford  Transit  1FTBW2CM5PKA00001',
      'NAME                          DATE OF BIRTH       LICENSE NUMBER',
      'Synthetic Driver One          01/01/1980          A12345678',
      'Property Address: 123 Example Road, Tucson, AZ 85701',
      'Company will pay claims only according to the policy terms.',
    ].join('\n') }]);
    const fields = reviewPolicySuggestions([parsed]);
    expect(fields.carrier).toBeUndefined();
    expect(fields.vehicles).toBe('2023  Ford  Transit  1FTBW2CM5PKA00001');
    expect(fields.drivers).toBe('Synthetic Driver One');
    expect(fields.properties).toBe('Property Address: 123 Example Road, Tucson, AZ 85701');
  });
  it('reconstructs out-of-order PDF fragments and aligns fields using page coordinates, not string lengths', () => {
    const items = [
      { text: '2027-11-06', x: 400, y: 680, width: 65, height: 11 },
      { text: 'Synthetic Fleet LLC', x: 40, y: 740, width: 110, height: 11 },
      { text: 'EXPIRATION DATE', x: 400, y: 700, width: 100, height: 11 },
      { text: 'POLICY', x: 40, y: 700, width: 40, height: 11 },
      { text: ' NUMBER', x: 80, y: 700, width: 55, height: 11 },
      { text: 'EFFECTIVE DATE', x: 240, y: 700, width: 100, height: 11 },
      { text: '2026-11-06', x: 240, y: 680, width: 65, height: 11 },
      { text: 'A-123', x: 40, y: 680, width: 30, height: 11 },
      { text: '1. NAMED INSURED', x: 40, y: 760, width: 150, height: 11 },
    ];
    const reconstructed = reconstructPolicyText(items);
    expect(reconstructed.text).toContain('POLICY NUMBER  EFFECTIVE DATE  EXPIRATION DATE');
    const result = suggestPolicyFields([{ ...reconstructed, page: 2, method: 'text', confidence: null }]);
    expect(Object.fromEntries(result.suggestions.map((item) => [item.field, item.value]))).toEqual({
      full_name: 'Synthetic Fleet LLC', policy_number: 'A-123', effective_date: '2026-11-06', expiration_date: '2027-11-06',
    });
    expect(result.suggestions.every((item) => item.page === 2)).toBe(true);
  });
  it('reads multiline declarations without requiring colons and keeps insured contact details separate from the agent', () => {
    const result = suggestPolicyFields([{ page: 1, method: 'text', confidence: null, text: [
      'COMMERCIAL GENERAL LIABILITY DECLARATIONS',
      'EXAMPLE PROPERTY AND CASUALTY INSURANCE COMPANY',
      'AGENT: Example Agency', 'Phone: (520) 555-0999',
      '1. NAMED INSURED AND MAILING ADDRESS',
      'Synthetic Workshop LLC', '123 Example Road', 'Tucson, AZ 85701',
      'POLICY NO. GL-987654', 'POLICY PERIOD',
      'From 11/06/2026 to 11/06/2027 at 12:01 AM',
      'TOTAL POLICY PREMIUM', '$2,345.67',
    ].join('\n') }]);
    expect(Object.fromEntries(result.suggestions.map((item) => [item.field, item.value]))).toMatchObject({
      full_name: 'Synthetic Workshop LLC', address: '123 Example Road, Tucson, AZ 85701',
      carrier: 'EXAMPLE PROPERTY AND CASUALTY INSURANCE COMPANY', policy_number: 'GL-987654',
      effective_date: '2026-11-06', expiration_date: '2027-11-06', premium: '2345.67',
      line_of_business: 'Commercial general liability',
    });
    expect(result.suggestions.filter((item) => item.field === 'phone')).toEqual([]);
  });
  it('keeps producer and insured columns separate for names, mailing addresses, email and phone', () => {
      const reconstructed = reconstructPolicyText([
        { text: 'AGENCY', x: 40, y: 760, width: 50, height: 11 },
        { text: '1. NAMED INSURED AND MAILING ADDRESS', x: 330, y: 760, width: 250, height: 11 },
        { text: 'Example Agency', x: 40, y: 740, width: 90, height: 11 },
        { text: 'Synthetic Fleet LLC', x: 330, y: 740, width: 110, height: 11 },
        { text: '987 Agency Street', x: 40, y: 720, width: 100, height: 11 },
        { text: '123 Example Road', x: 330, y: 720, width: 100, height: 11 },
        { text: 'Phoenix, AZ 85001', x: 40, y: 700, width: 100, height: 11 },
        { text: 'Tucson, AZ 85701', x: 330, y: 700, width: 100, height: 11 },
        { text: 'Phone: (520) 555-0999', x: 40, y: 680, width: 130, height: 11 },
        { text: 'Phone: (520) 555-0123', x: 330, y: 680, width: 130, height: 11 },
        { text: 'Email: broker@example.invalid', x: 40, y: 660, width: 190, height: 11 },
        { text: 'Email: insured@example.invalid', x: 330, y: 660, width: 190, height: 11 },
      ]);
      const result = suggestPolicyFields([{ ...reconstructed, page: 1, method: 'text', confidence: null }]);
      expect(Object.fromEntries(result.suggestions.map((item) => [item.field, item.value]))).toEqual({
        full_name: 'Synthetic Fleet LLC', address: '123 Example Road, Tucson, AZ 85701',
        phone: '(520) 555-0123', email: 'insured@example.invalid',
      });
    });
  it('reads aligned column headers and values from declaration tables', () => {
    const result = suggestPolicyFields([{ page: 3, method: 'text', confidence: null, text: [
      'POLICY NUMBER                  EFFECTIVE DATE          EXPIRATION DATE',
      'BAP-123456                     11/06/2026              11/06/2027',
      'NAMED INSURED                  INSURANCE COMPANY',
      'Synthetic Fleet LLC            Example Indemnity Company',
      'TOTAL PREMIUM: $7,890.12',
    ].join('\n') }]);
    expect(Object.fromEntries(result.suggestions.map((item) => [item.field, item.value]))).toMatchObject({
      policy_number: 'BAP-123456', effective_date: '2026-11-06', expiration_date: '2027-11-06',
      full_name: 'Synthetic Fleet LLC', carrier: 'Example Indemnity Company', premium: '7890.12',
    });
  });
  it('reads adjacent inline fields and month-name dates without leaking labels into values', () => {
    const result = suggestPolicyFields([{ page: 1, method: 'ocr', confidence: 90, text: [
      'Policy No: WC-4455  Effective Date: November 6, 2026  Expiration Date: November 6, 2027',
      'Named Insured: Synthetic Service LLC  Carrier: Example Carrier',
      'Annual Premium $1,234.50',
    ].join('\n') }]);
    expect(Object.fromEntries(result.suggestions.map((item) => [item.field, item.value]))).toMatchObject({
      policy_number: 'WC-4455', full_name: 'Synthetic Service LLC', carrier: 'Example Carrier',
      effective_date: '2026-11-06', expiration_date: '2027-11-06', premium: '1234.50',
    });
  });
  it('never promotes policy prose, agent details or a missing-value label into an insured field', () => {
    const result = suggestPolicyFields([{ page: 4, method: 'text', confidence: null, text: [
      'If the named insured requests cancellation, this condition applies.',
      'The effective date of cancellation is determined under the following provision.',
      'Named Insured', 'Policy Number', 'Not assigned',
      'Expiration Date: 02/30/2026',
      'AGENT INFORMATION', 'Example Brokerage', 'Email: broker@example.invalid',
    ].join('\n') }]);
    expect(result.suggestions).toEqual([]);
  });
  it('proposes only labeled supported fields with exact page evidence and normalized dates', () => {
    const result = suggestPolicyFields([{ page: 2, method: 'text', confidence: null, text: [
      'DECLARATIONS', 'Named Insured: Synthetic Example LLC', 'Carrier: Example Carrier',
      'Policy Number: QA-123', 'Effective Date: 11/06/2026', 'Expiration Date: 11/06/2027',
      'Total Premium: $1,234.50', 'SSN: 123-45-6789', 'Bank Account: 123456789',
    ].join('\n') }]);
    expect(result.kind).toBe('declarations');
    expect(result.suggestions).toEqual([
      { field: 'full_name', value: 'Synthetic Example LLC', page: 2, excerpt: 'Named Insured: Synthetic Example LLC' },
      { field: 'carrier', value: 'Example Carrier', page: 2, excerpt: 'Carrier: Example Carrier' },
      { field: 'policy_number', value: 'QA-123', page: 2, excerpt: 'Policy Number: QA-123' },
      { field: 'effective_date', value: '2026-11-06', page: 2, excerpt: 'Effective Date: 11/06/2026' },
      { field: 'expiration_date', value: '2027-11-06', page: 2, excerpt: 'Expiration Date: 11/06/2027' },
      { field: 'premium', value: '1234.50', page: 2, excerpt: 'Total Premium: $1,234.50', priority: 2 },
    ]);
  });
  it('keeps contradictory policy numbers as separate review evidence and never invents missing facts', () => {
    const result = suggestPolicyFields([
      { page: 1, method: 'ocr', confidence: 60, text: 'Insurance ID Card\nPolicy Number: A-1\nEffective Date: 02/30/2026' },
      { page: 2, method: 'ocr', confidence: 95, text: 'Policy Number: B-2\nTotal Premium: UNKNOWN' },
    ]);
    expect(result.kind).toBe('id_card');
    expect(result.suggestions.map((item) => item.value)).toEqual(['A-1', 'B-2']);
  });
  it('enforces exact upload size and supported document types', () => {
    expect(() => validateIntakeFile({ name: 'policy.pdf', type: 'application/pdf', size: INTAKE_MAX_FILE_BYTES })).not.toThrow();
    expect(() => validateIntakeFile({ name: 'policy.pdf', type: 'application/pdf', size: INTAKE_MAX_FILE_BYTES + 1 })).toThrow('25 MB');
    expect(() => validateIntakeFile({ name: 'photo.heic', type: 'image/heic', size: 100 })).toThrow('Convert');
    expect(() => validateIntakeFile({ name: 'script.pdf', type: 'text/html', size: 100 })).toThrow('Use a PDF');
    expect(() => validateIntakeFile({ name: 'policy.pdf', type: 'application/pdf', size: 0 })).toThrow('nonempty');
  });
});
