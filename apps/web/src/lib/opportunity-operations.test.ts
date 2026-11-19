import { describe, it, expect } from 'vitest';
import { DEFAULT_OPPORTUNITY_SETTINGS, EMPTY_OPPORTUNITY_PROFILE } from '@crm/shared';
import { parseOpportunityOutcome, parseOpportunitySettings, opportunityTarget } from './opportunity-operations';
import { opportunityMetrics, type RecordedOutcome } from './opportunity-metrics';

describe('agency-configurable OIP targeting', () => {
  it('accepts reusable defaults without hard-coding an industry or territory', () => {
    expect(parseOpportunitySettings(DEFAULT_OPPORTUNITY_SETTINGS)).toEqual(DEFAULT_OPPORTUNITY_SETTINGS);
    expect(opportunityTarget(EMPTY_OPPORTUNITY_PROFILE, DEFAULT_OPPORTUNITY_SETTINGS)).toBe('unknown');
  });
  it.each([
    { states: 'Arizona' }, { revenue_min: 100, revenue_max: 20 }, { agent_capacity: 0 },
    { refresh_days: 0 }, { digest_hour: 24 }, { recurring_enabled: 'true' }, { paid_budget: 500 },
  ])('rejects invalid limits or unsupported spending knobs: %j', (patch) => {
    expect(() => parseOpportunitySettings({ ...DEFAULT_OPPORTUNITY_SETTINGS, ...patch })).toThrow();
  });
  it('uses exact normalized terms and inclusive business-size thresholds', () => {
    const config = { ...DEFAULT_OPPORTUNITY_SETTINGS, industries: 'Restaurant', states: 'AZ, NM', lines: 'General liability', revenue_min: 100, revenue_max: 200 };
    const profile = { ...EMPTY_OPPORTUNITY_PROFILE, facts: { industry: 'restaurant', state: 'az', line: 'General liability', annual_revenue: '100' } };
    expect(opportunityTarget(profile, config, '2026-03-01', '2026-01-01')).toBe('targeted');
    expect(opportunityTarget({ ...profile, facts: { ...profile.facts, annual_revenue: '200' } }, config, '2026-03-01', '2026-01-01')).toBe('targeted');
    expect(opportunityTarget({ ...profile, facts: { ...profile.facts, annual_revenue: '201' } }, config)).toBe('outside_target');
    expect(opportunityTarget({ ...profile, facts: { industry: 'restaurant' } }, config)).toBe('unknown');
    expect(opportunityTarget(profile, { ...config, excluded_industries: 'restaurant' })).toBe('outside_target');
    expect(opportunityTarget({ ...profile, facts: { ...profile.facts, line: 'GL' } }, config)).toBe('outside_target');
  });
  it('uses the configured renewal window inclusively and leaves missing timing unknown', () => {
    const settings = { ...DEFAULT_OPPORTUNITY_SETTINGS, renewal_days: 30 };
    expect(opportunityTarget(EMPTY_OPPORTUNITY_PROFILE, settings, '2026-01-31', '2026-01-01')).toBe('targeted');
    expect(opportunityTarget(EMPTY_OPPORTUNITY_PROFILE, settings, '2026-02-01', '2026-01-01')).toBe('outside_target');
    expect(opportunityTarget(EMPTY_OPPORTUNITY_PROFILE, settings, '2025-12-31', '2026-01-01')).toBe('outside_target');
  });
});
describe('confirmed outcomes and measured metrics', () => {
  const outcome = { stage: 'qualified', occurred_on: '2026-01-02', reason: '', source: 'Authorized file', cost: 0, premium: null };
  it('requires documented reasons for decline/loss, rejects future dates and estimated premium', () => {
    expect(parseOpportunityOutcome(outcome, '2026-01-03')).toEqual(outcome);
    for (const patch of [{ stage: 'lost' }, { stage: 'declined' }, { occurred_on: '2026-02-01' }, { cost: -1 }, { premium: 500 }, { stage: 'made_up' }]) {
      expect(() => parseOpportunityOutcome({ ...outcome, ...patch }, '2026-01-03')).toThrow();
    }
    expect(parseOpportunityOutcome({ ...outcome, stage: 'bound', premium: 500 }, '2026-01-03').premium).toBe(500);
  });
  it('counts unique businesses per stage and uses latest actual premium instead of summing revisions', () => {
    const row = (scope: string, patch: Partial<RecordedOutcome['payload']>, time = '2026-01-02T00:00:00Z'): RecordedOutcome => ({
      scope_key: scope, payload: { ...outcome, stage: 'qualified', ...patch }, created_at: time,
    });
    const metrics = opportunityMetrics([
      row('lead:a', { cost: 10 }), row('lead:a', { cost: 5 }), row('lead:b', { stage: 'contact_verified', cost: 5 }),
      row('lead:a', { stage: 'bound', premium: 100 }), row('lead:a', { stage: 'bound', premium: 200 }, '2026-01-02T01:00:00Z'),
      row('lead:b', { stage: 'lost', reason: 'Timing' }), row('lead:c', { occurred_on: '2025-12-01', cost: 999 }),
    ], '2026-01-01', '2026-01-31');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ businesses: 2, cost: 20, cost_per_qualified: 20, written_premium: 200,
      verified_rate: .5, bind_rate: .5, decline_reasons: ['Timing'] });
    expect(metrics[0].stages.qualified).toBe(1);
  });
  it('does not fabricate zero cost per qualified opportunity without labels', () => {
    const rows: RecordedOutcome[] = [{ scope_key: 'lead:a', payload: { ...outcome, stage: 'discovered' }, created_at: '2026-01-02' }];
    expect(opportunityMetrics(rows, '2026-01-01', '2026-01-31')[0].cost_per_qualified).toBeNull();
    expect(opportunityMetrics(rows, '2026-02-01', '2026-02-02')).toEqual([]);
  });
});
