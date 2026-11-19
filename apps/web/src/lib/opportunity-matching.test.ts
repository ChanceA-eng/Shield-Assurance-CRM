import { describe, it, expect } from 'vitest';
import { EMPTY_DOSSIER_FINDINGS, appetiteScopesOverlap, type CarrierAppetiteDocument, type IntelligenceDossier, type OpportunityProfile } from '@crm/shared';
import { evaluateOpportunity, parseOpportunityProfile, parseAppetitePredicate } from './opportunity-matching';
const today = '2026-11-10';
const dossier = (): IntelligenceDossier => ({ scope_key: 'lead:synthetic', record_name: 'Synthetic Business', version: 0,
  findings: { ...EMPTY_DOSSIER_FINDINGS }, confirmations: [], observations: [], observations_total: 0, history_total: 0, page: 0 });
const profile = (): OpportunityProfile => ({ facts: { state: 'AZ', line: 'General liability', industry: 'Restaurant', years_in_business: '3', has_delivery: 'no' },
  confirmed_on: today, source_reference: 'Synthetic permissioned business verification', permission: 'permitted',
  contactability: 'verified_email', relationship: 'referred' });
const document = (): CarrierAppetiteDocument => ({
  id: 'one', revision: 2, state: 'active', file_name: 'guide.txt', storage_path: '', pages: [],
  approved_by: 'owner', approved_at: '2026-11-01T00:00:00Z',
  values: { carrier: 'Example', title: '2026 guide', line: 'General liability', states: 'AZ, NV', effective_on: '2026-01-01', expires_on: '2027-01-01',
    access: 'direct', access_reference: 'Reviewed appointment', rights_reference: 'Authorized carrier guide',
    rules: [
      { id: 'class', criterion: 'Restaurants preferred', decision: 'preferred', page: 1, excerpt: 'Restaurants',
        predicate: { field: 'industry', operator: 'is', value: 'Restaurant' } },
      { id: 'min', criterion: 'At least three years', decision: 'condition', page: 1, excerpt: '3 years minimum',
        predicate: { field: 'years_in_business', operator: 'gte', value: '3' } },
      { id: 'ex', criterion: 'No delivery', decision: 'excluded', page: 1, excerpt: 'Delivery operations prohibited',
        predicate: { field: 'has_delivery', operator: 'is', value: 'yes' } },
    ] },
});
describe('conservative OIP market matching and reproducible priority', () => {
  it('separates same-carrier auto and property, respects coverage aliases and treats unknown scope conservatively', () => {
    const auto = document(), property = document();
    auto.values.line = 'Commercial auto'; property.values.line = 'Commercial property'; property.id = 'property';
    const business = profile(); delete business.facts.line;
    const assessment = evaluateOpportunity(business, [auto, property], dossier(), today);
    expect(assessment.markets.map((market) => market.status)).toEqual(['possible_fit', 'possible_fit']);
    expect(assessment.markets.every((market) => !market.reasons.some((reason) => /Other guides/.test(reason)))).toBe(true);
    expect(evaluateOpportunity({ ...business, facts: { ...business.facts, line: 'Business auto' } }, [auto, property], dossier(), today).markets).toHaveLength(1);
    expect(appetiteScopesOverlap(auto.values, { ...auto.values, line: 'fleet' })).toBe(true);
    expect(appetiteScopesOverlap(auto.values, { ...auto.values, line: '' })).toBe(true);
    expect(appetiteScopesOverlap(auto.values, { ...auto.values, states: 'NY' })).toBe(false);
  });
  it('reuses compiled fleet criteria for public facts and produces a provisional recommendation without pretending placement or consent', () => {
    const guide = document(); guide.values.line = 'Commercial auto';
    guide.values.rules = [{ id: 'fleet', criterion: 'At least 11 power units', decision: 'eligible', page: 1, excerpt: '11+ power units',
      predicate: { field: 'power_units', operator: 'gte', value: '11' } }];
    const publicProfile: OpportunityProfile = { ...profile(), facts: { state: 'AZ', power_units: '12' }, confirmed_on: '', permission: 'unknown' };
    const market = evaluateOpportunity(publicProfile, [guide], dossier(), today, ['state', 'power_units']);
    expect(market.markets[0].recommendation).toContain('Worth reviewing for Commercial auto: At least 11 power units');
    expect(market.markets[0].rules[0].result).toBe('matched');
    expect(market.status).toBe('needs_review');
    expect(market.score.contactability).toBe(0);
    publicProfile.facts.power_units = '10';
    expect(evaluateOpportunity(publicProfile, [guide], dossier(), today, ['state', 'power_units']).markets[0].recommendation).toContain('More information needed');
  });
  it('only produces possible fit when every required criterion, source and access gate is known', () => {
    const result = evaluateOpportunity(profile(), [document()], dossier(), today);
    expect(result.status).toBe('possible_fit');
    expect(result.markets[0].rules.map((rule) => rule.result)).toEqual(['matched', 'matched', 'not_matched']);
    expect(result.score).toMatchObject({ fit: 40, timing: 0, evidence: 10, contactability: 10, relationship: 3, total: 63 });
    expect(result.score.explanations.join(' ')).toContain('not a placement probability');
    expect(result).toEqual(evaluateOpportunity(profile(), [document()], dossier(), today));
  });
  it.each([['2.99', 'excluded'], ['3', 'possible_fit'], ['3.01', 'possible_fit']] as const)('tests inclusive minimum boundary %s', (years, status) => {
    const business = profile(); business.facts.years_in_business = years;
    expect(evaluateOpportunity(business, [document()], dossier(), today).status).toBe(status);
  });
  it.each([['2.99', 'possible_fit'], ['3', 'possible_fit'], ['3.01', 'excluded']] as const)('tests inclusive maximum boundary %s', (years, status) => {
    const business = profile(); business.facts.years_in_business = years;
    const guide = document(); guide.values.rules[1].predicate!.operator = 'lte';
    expect(evaluateOpportunity(business, [guide], dossier(), today).status).toBe(status);
  });
  it('exclusion beats positive matches and a missing negative fact never becomes a pass', () => {
    const business = profile(); business.facts.has_delivery = 'yes';
    expect(evaluateOpportunity(business, [document()], dossier(), today).status).toBe('excluded');
    delete business.facts.has_delivery;
    expect(evaluateOpportunity(business, [document()], dossier(), today).status).toBe('needs_review');
  });
  it('keeps free-form and compound criteria manual instead of turning text similarity into eligibility', () => {
    const guide = document(); delete guide.values.rules[0].predicate;
    expect(evaluateOpportunity(profile(), [guide], dossier(), today).status).toBe('needs_review');
    expect(() => parseAppetitePredicate({ field: 'revenue', operator: 'gte', value: 500000 })).toThrow();
    expect(() => parseAppetitePredicate({ field: 'industry', operator: 'gte', value: 'Restaurant' })).toThrow();
    expect(() => parseAppetitePredicate({ field: 'years_in_business', operator: 'gte', value: 'three' })).toThrow();
  });
  it('flags referral, overlapping guidance, expired sources and future guidelines', () => {
    const guide = document(); guide.values.rules[2].decision = 'referral'; guide.values.rules[2].predicate!.value = 'no';
    expect(evaluateOpportunity(profile(), [guide], dossier(), today).status).toBe('needs_review');
    expect(evaluateOpportunity(profile(), [document(), { ...document(), id: 'two' }], dossier(), today).markets.every((market) => market.status === 'needs_review')).toBe(true);
    for (const dates of [{ expires_on: '2026-11-09' }, { effective_on: '2026-11-11' }]) {
      const source = document(); Object.assign(source.values, dates);
      expect(evaluateOpportunity(profile(), [source], dossier(), today).status).toBe('needs_review');
    }
  });
  it('matches an undated guide without inventing policy dates or expiry', () => {
    const guide = document(); guide.values.effective_on = ''; guide.values.expires_on = '';
    guide.approved_at = '2025-01-01T00:00:00Z';
    expect(evaluateOpportunity(profile(), [guide], dossier(), today).status).toBe('possible_fit');
    const business = profile(); business.facts.has_delivery = 'yes';
    expect(evaluateOpportunity(business, [guide], dossier(), today).status).toBe('excluded');
  });
  it('does not merge separate carriers or treat missing access as placement', () => {
    const unavailable = document(); unavailable.values.access = 'unavailable';
    const other = document(); other.id = 'two'; other.values.carrier = 'Another'; other.values.access = 'unconfirmed';
    const result = evaluateOpportunity(profile(), [unavailable, other], dossier(), today);
    expect(result.markets.map((market) => market.status)).toEqual(['excluded', 'needs_review']);
    expect(result.status).toBe('needs_review');
    expect(result.markets[0].carrier).toBe('Example');
  });
  it('does not require appointment proof when the producer selects a placement route', () => {
    const guide = document();
    guide.values.access_reference = '';
    guide.values.rights_reference = '';
    expect(evaluateOpportunity(profile(), [guide], dossier(), today).status).toBe('possible_fit');
  });
  it('does not confirm a fit when unreadable guide entries could contain exclusions', () => {
    const guide = document();
    guide.values.unresolved_entries = [{ criterion: 'Unmatched restriction', page: 1, reason: 'Source text could not be matched.' }];
    const result = evaluateOpportunity(profile(), [guide], dossier(), today);
    expect(result.status).toBe('needs_review');
    expect(result.markets[0].reasons).toContain('Some guide entries could not be read reliably. A carrier fit is not confirmed.');
  });
  it('never counts stale/future business facts or fuzzy territory and line names as confirmed matches', () => {
    for (const patch of [{ confirmed_on: '2026-08-11' }, { confirmed_on: '2026-11-11' },
      { facts: { ...profile().facts, state: 'Arizona' } }, { facts: { ...profile().facts, line: 'General' } }]) {
      expect(evaluateOpportunity({ ...profile(), ...patch }, [document()], dossier(), today).status).toBe('needs_review');
    }
    expect(evaluateOpportunity({ ...profile(), confirmed_on: '2026-08-12' }, [document()], dossier(), today).status).toBe('possible_fit');
  });
  it('does not accept an invalid activation timestamp as current underwriting authority', () => {
    const guide = document(); guide.approved_at = 'not-a-date';
    expect(evaluateOpportunity(profile(), [guide], dossier(), today).status).toBe('needs_review');
    guide.approved_at = '2026-11-11T00:00:00Z';
    const business = profile(); business.facts.has_delivery = 'yes';
    expect(evaluateOpportunity(business, [guide], dossier(), today).status).toBe('needs_review');
  });
  it('awards timing only for a current exact confirmed renewal and not an imported estimate', () => {
    const record = dossier(); record.version = 1;
    record.findings = { ...record.findings, renewal_date: '2026-12-10', renewal_line: 'GL' };
    record.current_confirmation = { id: 'confirmation', scope_key: record.scope_key, version: 1, actor_id: 'agent',
      observed_at: '2026-11-10T00:00:00Z', source_as_of: today, reference: 'Prospect call', findings: record.findings };
    expect(evaluateOpportunity(profile(), [document()], record, today).score.timing).toBe(25);
    record.findings.renewal_date = '2027-02-09';
    expect(evaluateOpportunity(profile(), [document()], record, today).score.timing).toBe(0);
    record.current_confirmation.source_as_of = '2026-01-01';
    expect(evaluateOpportunity(profile(), [document()], record, today).score.evidence).toBe(10);
  });
  it('does not equate ranking or a reply with permission and accepts only business-specific fields', () => {
    const business = { ...profile(), permission: 'do_not_contact' as const };
    const result = evaluateOpportunity(business, [document()], dossier(), today);
    expect(result.next_step).toContain('Do not contact');
    expect(result.score.contactability).toBe(0);
    expect(() => parseOpportunityProfile({ ...profile(), facts: { ...profile().facts, ssn: 'private' } }, today)).toThrow('business facts');
    expect(() => parseOpportunityProfile({ ...profile(), confirmed_on: '2026-02-30' }, today)).toThrow();
    expect(() => parseOpportunityProfile({ ...profile(), facts: { annual_revenue: '$50,000' } }, today)).toThrow('numeric');
  });
});
