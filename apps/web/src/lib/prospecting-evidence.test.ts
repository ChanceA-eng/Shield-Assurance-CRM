import { describe, expect, it } from 'vitest';
import type { BusinessObservation, BusinessResearchProfile } from '@crm/shared';
import { prospectingEvidence, prospectingReadiness } from './prospecting-evidence';

const now = new Date('2026-11-10T12:00:00.000Z');

function observation(source: BusinessObservation['source'], values: Partial<BusinessObservation['values']>, overrides: Partial<BusinessObservation> = {}): BusinessObservation {
  return {
    source, record_id: `${source}-record`, url: 'https://example.invalid/record',
    fetched_at: '2026-11-08T12:00:00.000Z', source_as_of: '2026-11-05',
    values: {
      name: 'Example Business', street: null, city: null, state: null, zip: null, phone: null, email: null, website: null,
      latitude: null, longitude: null, industry: null, naics: null, classification: 'reported', dot: null, ein: null,
      power_units: null, drivers: null, registration_reported_on: null, filing_year: null, assets: null, revenue: null,
      ...values,
    },
    ...overrides,
  };
}

function profile(observations: BusinessObservation[]): BusinessResearchProfile {
  return { business: { id: 'business-id', name: 'Example Business', observations, updated_at: '2026-11-08T12:00:00.000Z', status: 'ready' },
    linked_record: { type: 'lead', id: 'lead-id' }, job: null };
}

describe('fresh prospecting evidence', () => {
  it('uses recent fleet counts and mapped business categories as separate source-backed hooks', () => {
    const result = prospectingEvidence(profile([
      observation('fmcsa_census', { power_units: 11 }),
      observation('osm', { industry: 'plumbing', classification: 'mapped' }, { source_as_of: null }),
    ]), now);

    expect(result.map((item) => item.text)).toEqual([
      'A fleet record lists 11 power units (reported 2026-11-05).',
      'A recent business listing categorizes the company as plumbing (retrieved 2026-11-08).',
    ]);
    expect(result[0]).toMatchObject({ source: 'FMCSA Census', recordId: 'fmcsa_census-record' });
  });

  it('rejects stale, future-dated, and undated regulatory facts', () => {
    const result = prospectingEvidence(profile([
      observation('fmcsa_census', { power_units: 15 }, { fetched_at: '2026-10-01T12:00:00.000Z' }),
      observation('fmcsa_census', { power_units: 20 }, { source_as_of: '2026-06-01' }),
      observation('fmcsa_census', { power_units: 25 }, { source_as_of: null }),
      observation('osm', { industry: 'plumbing', classification: 'mapped' }, { fetched_at: '2026-10-01T12:00:00.000Z', source_as_of: null }),
    ]), now);

    expect(result).toEqual([]);
  });

  it('withholds specific hooks when the research contains conflicting identity evidence', () => {
    const result = profile([observation('fmcsa_census', { power_units: 11 })]);
    result.job = {
      state: 'complete', error: null,
      result: { insights: [{ kind: 'conflict', text: 'Conflicting business match', sources: [] }], coverage: [], context: [], market_fit: null },
    };
    expect(prospectingEvidence(result, now)).toEqual([]);
    expect(prospectingReadiness(result, [], now)).toMatchObject({ data_level: 'contact-only', suggested_priority: 'C', needs_confirmation: true });
  });

  it('suggests priority from fresh evidence and confirmed timing without promoting predicted renewals', () => {
    const result = profile([observation('fmcsa_census', { power_units: 11 })]);
    const renewal = { type: 'Commercial auto', date: '2027-01-15', evidence_class: 'confirmed', precision: 'date',
      confirmed_by: 'Producer', confirmed_on: '2026-11-01' };
    expect(prospectingReadiness(result, [renewal], now)).toMatchObject({ data_level: 'full', suggested_priority: 'A', nurture_on: null });
    expect(prospectingReadiness(result, [{ ...renewal, evidence_class: 'predicted' }], now))
      .toMatchObject({ data_level: 'size', suggested_priority: 'B', confirmed_renewal: null });
    expect(prospectingReadiness(result, [{ ...renewal, date: '2027-06-01' }], now))
      .toMatchObject({ suggested_priority: 'B', nurture_on: '2027-01-22' });
  });
});
