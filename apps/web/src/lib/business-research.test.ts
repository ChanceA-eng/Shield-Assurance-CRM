import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BUSINESS_SEARCH, EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, type BusinessObservation } from '@crm/shared';
import { businessSearchFilters, researchIdentity, researchInsights, researchMatchingFacts } from './business-research';
import { resolveTerritory, searchCensus, searchIrs, searchOsm, sourceApplicability } from './business-research-sources';
import { evaluateOpportunity } from './opportunity-matching';
import { matchedWorkplaceInspections } from './business-research-jobs';
import type { OshaInspectionRecord } from './enrichment';
import { researchPlaces } from './research-geography';

afterEach(() => { vi.unstubAllGlobals(); });
const filters = (input = {}) => ({ ...EMPTY_BUSINESS_SEARCH, ...input });
function json(value: unknown): void { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value)))); }
async function observation(): Promise<BusinessObservation> {
  json([{ dot_number: '12345', legal_name: 'Synthetic Fleet', phy_street: '1 Synthetic Street', phy_city: 'Tucson', phy_state: 'AZ', phy_zip: '85701',
    phone: '520-555-0101', cell_phone: '520-555-0199', email_address: 'office@example.invalid', power_units: '12', total_drivers: '9', mcs150_date: '20250230' }]);
  return (await searchCensus(filters({ state: 'AZ' }), 0))[0];
}
describe('capability-aware business discovery', () => {
  it('accepts empty, category-only, state-only, and ZIP-only filters for browsing', () => {
    for (const input of [{}, { naics: '238220' }, { state: 'AZ' }, { zip: '85705' }]) {
      expect(sourceApplicability(businessSearchFilters(input))).toEqual(['osm']);
    }
  });
  it('requires a supported U.S. territory/category without silently accepting ignored filters', () => {
    expect(() => businessSearchFilters(filters({ industry: 'restaurant', state: 'ZZ' }))).toThrow('valid U.S.');
    expect(() => businessSearchFilters({ ...filters({ query: 'business' }), unknown: 'ignored' })).toThrow('unsupported');
    expect(businessSearchFilters(filters({ naics: '722511', state: 'AZ' })).naics).toBe('722511');
    expect(sourceApplicability(businessSearchFilters(filters({ naics: '484', state: 'AZ' })))).toEqual(['dol_5500']);
    expect(() => businessSearchFilters(filters({ naics: '999999', state: 'AZ' }))).toThrow('official 2022');
    expect(() => businessSearchFilters(filters({ naics: '722', industry: 'trucking', state: 'AZ' }))).toThrow('must agree');
    expect(sourceApplicability(businessSearchFilters(filters({ naics: '722', state: 'AZ', city: 'Tucson' })))).toEqual(['osm', 'dol_5500']);
    expect(sourceApplicability(businessSearchFilters(filters({ industry: 'nonprofit', state: 'AZ' })))).toEqual(['irs']);
  });
  it('parses only public business fields and does not apply registration dates to contact freshness', async () => {
    const row = await observation();
    expect(row.values).toMatchObject({ dot: '12345', phone: '520-555-0101', power_units: 12, drivers: 9, registration_reported_on: null });
    expect(row.source_as_of).toBeNull();
    expect(JSON.stringify(row)).not.toContain('520-555-0199');
    expect(row.values.naics).toBeNull();
  });
  it('does not substitute another state, and escapes provider queries instead of interpolating raw conditions', async () => {
    json([{ dot_number: '12345', legal_name: 'Synthetic', phy_state: 'CA' }]);
    expect(await searchCensus(filters({ query: "O'Brien%_ or 1=1", state: 'AZ' }), 2)).toEqual([]);
    const input = vi.mocked(fetch).mock.calls[0][0];
    const url = new URL(String(input));
    expect(url.searchParams.get('$where')).toContain("O''BRIEN OR 1=1");
    expect(url.searchParams.get('$offset')).toBe('50');
  });
  it('validates a selected city against its state and uses its official center for radius searches', async () => {
    const tucson = researchPlaces('AZ').find((item) => item.name === 'Tucson');
    if (!tucson) throw new Error('Official Tucson reference is missing.');
    expect(() => businessSearchFilters(filters({ industry: 'restaurant', state: 'CA', place_id: tucson.id }))).toThrow('belonging');
    const selected = businessSearchFilters(filters({ naics: '722511', state: 'AZ', place_id: tucson.id, radius_miles: '10', contact: 'phone' }));
    expect(selected.city).toBe('Tucson');
    json({ elements: [] });
    await searchOsm(selected, { south: 31, west: -112, north: 33, east: -110 }, 0);
    const body = String(vi.mocked(fetch).mock.calls[0][1]?.body);
    const query = new URLSearchParams(body).get('data');
    expect(query).toContain(`around:16093.44,${tucson.latitude},${tucson.longitude}`);
    expect(query).toContain('^restaurant$');
    expect(query).toContain('contact:phone');
  });
  it('pushes fleet and contact filters into discovery, and rejects unsupported or inverted ranges', async () => {
    json([]);
    const selected = businessSearchFilters(filters({ industry: 'trucking', state: 'AZ', min_power_units: '5', max_power_units: '20', contact: 'email' }));
    await searchCensus(selected, 0);
    const where = new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('$where');
    expect(where).toContain('power_units>=5');
    expect(where).toContain('power_units<=20');
    expect(where).toContain("email_address<>''");
    expect(() => businessSearchFilters({ ...selected, max_power_units: '4' })).toThrow('cannot exceed');
    expect(() => businessSearchFilters({ ...selected, industry: 'restaurant' })).toThrow('require DOT');
    expect(sourceApplicability({ ...selected, contact: 'website' })).toEqual([]);
  });
  it('does not merge on a shared phone or name; exact business/address/ZIP corroborates cross-source records', async () => {
    const row = await observation(), key = researchIdentity(row);
    expect(researchIdentity({ ...row, source: 'osm', record_id: 'node/22' })).toBe(key);
    expect(researchIdentity({ ...row, record_id: '54321', values: { ...row.values, street: '2 Synthetic Street' } })).not.toBe(key);
    const noStreet = { ...row, values: { ...row.values, street: null } };
    expect(researchIdentity(noStreet)).not.toBe(researchIdentity({ ...noStreet, record_id: '54321' }));
  });
  it('reports contact conflicts as verification questions, not a coverage gap or consent', async () => {
    const row = await observation();
    const insights = researchInsights([row, { ...row, source: 'osm', record_id: 'node/22', values: { ...row.values, phone: '520-555-0102' } }]);
    expect(insights.some((item) => item.kind === 'conflict')).toBe(true);
    expect(insights.find((item) => item.kind === 'fact')?.text).toContain('not an employee count');
    expect(insights.map((item) => item.text).join(' ')).not.toContain('coverage gap');
    expect(researchInsights([row, { ...row, source: 'osm', record_id: 'node/22',
      values: { ...row.values, phone: '+1 (520) 555-0101' } }]).some((item) => item.kind === 'conflict')).toBe(false);
  });
  it('does not refresh old or undated underwriting facts merely by retrieving them again', async () => {
    const row = await observation(), now = new Date('2026-11-11T12:00:00Z');
    row.fetched_at = now.toISOString();
    expect(researchMatchingFacts([row], now)).toEqual({ facts: {}, current: [] });
    row.values.registration_reported_on = '2026-11-01';
    expect(researchMatchingFacts([row], now)).toEqual({ facts: { power_units: '12' }, current: ['power_units'] });
    row.values.registration_reported_on = '2020-01-01';
    expect(researchMatchingFacts([row], now).current).toEqual([]);
  });
  it('rejects a resolved territory in a different state instead of searching it', async () => {
    json([{ boundingbox: ['32', '33', '-111', '-110'], address: { country_code: 'us', 'ISO3166-2-lvl4': 'US-CA' } }]);
    await expect(resolveTerritory(filters({ city: 'Tucson', state: 'AZ' }))).rejects.toThrow('could not be resolved');
  });
  it('preserves mapped OSM category provenance and excludes contacts from private/mobile tags', async () => {
    json({ elements: [{ type: 'node', id: 12, lat: 32, lon: -110, tags: { name: 'Synthetic Cafe', amenity: 'cafe', 'contact:mobile': 'private',
      'addr:postcode': '85701', 'contact:phone': '520-555-0101' } }] });
    const rows = await searchOsm(filters({ naics: '722', city: 'Tucson', state: 'AZ', zip: '85701' }), { south: 31, west: -112, north: 33, east: -110 }, 0);
    expect(rows[0].values).toMatchObject({ industry: 'Restaurants and cafes', naics: null, classification: 'mapped', phone: '520-555-0101' });
    expect(JSON.stringify(rows)).not.toContain('private');
    await expect(searchOsm(filters(), { south: 31, west: -112, north: 33, east: -110 }, 1)).rejects.toThrow('capped');
    json({ elements: [{ type: 'node', id: 12, lat: 100, lon: -110, tags: { name: 'Synthetic Cafe' } }] });
    await expect(searchOsm(filters(), { south: 31, west: -112, north: 33, east: -110 }, 0)).rejects.toThrow('coordinates');
  });
  it('keeps IRS filing history dated and omits unrelated filing personal fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('EIN,NAME,STREET,CITY,STATE,ZIP,TAX_PERIOD,ASSET_AMT,REVENUE_AMT,ICO\n123456789,Synthetic Charity,1 Synthetic Street,Tucson,AZ,85701,202312,100,200,Private Person\n')));
    const rows = await searchIrs(filters({ industry: 'nonprofit', state: 'AZ' }), 0);
    expect(rows[0].values).toMatchObject({ ein: '123456789', filing_year: '202312', assets: 100, revenue: 200, naics: null });
    expect(JSON.stringify(rows)).not.toContain('Private Person');
  });
  it('does not turn a recent public observation into a human confirmation or permission to contact', () => {
    const assessment = evaluateOpportunity({ ...EMPTY_OPPORTUNITY_PROFILE, facts: { state: 'AZ', power_units: '12' } }, [], {
      scope_key: 'business:test', record_name: 'Synthetic', version: 0, findings: EMPTY_DOSSIER_FINDINGS,
      confirmations: [], observations: [], observations_total: 0, history_total: 0, page: 0,
    }, '2026-11-11', ['state', 'power_units']);
    expect(assessment.status).toBe('needs_review');
    expect(assessment.score.contactability).toBe(0);
    expect(assessment.score.evidence).toBe(0);
    expect(assessment.missing).toContain('Current permission to contact must be confirmed; matching never establishes consent.');
  });
  it('attaches workplace history only to the same named establishment and complete exact public address', async () => {
    const row = await observation();
    const inspection: OshaInspectionRecord = { activity_nr: '123456789', establishment: 'Synthetic Fleet LLC', street: '1 Synthetic St. Ste 210',
      city: 'Tucson', state: 'AZ', zip: '85701-1234', open_date: '2025-01-01', case_status: null, inspection_type: null,
      violations_serious: 1, violations_willful: null, violations_repeat: null, violations_other: null, total_penalty: null };
    expect(matchedWorkplaceInspections([row], [inspection])).toEqual([inspection]);
    expect(matchedWorkplaceInspections([row], [{ ...inspection, zip: null }])).toEqual([{ ...inspection, zip: null }]);
    for (const change of [{ street: null }, { street: '2 Synthetic Street' }, { zip: '85702' }, { establishment: 'Different Fleet' }]) {
      expect(matchedWorkplaceInspections([row], [{ ...inspection, ...change }])).toEqual([]);
    }
  });
});
