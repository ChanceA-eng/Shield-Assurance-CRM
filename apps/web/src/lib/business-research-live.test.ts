import { describe, expect, it } from 'vitest';
import { EMPTY_BUSINESS_SEARCH } from '@crm/shared';
import { searchCensus, searchIrs } from './business-research-sources';
import { directoryBatch, findIrsFilings } from './business-research-index';
import { readIrsFinancials } from './business-research-irs-filing';

describe.skipIf(process.env.CRM_PUBLIC_RESEARCH_QA_ALLOWED !== '1')('read-only public discovery source contracts', () => {
  it('reads actual bounded public OSM business points without an Overpass server', async () => {
    const batch = await directoryBatch({ provider: 'osm', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(40000));
    expect(batch.cursor).toBeGreaterThan(0);
    expect(batch.cursor).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(batch.complete).toBe(false);
    expect(batch.items.length).toBeGreaterThan(0);
    for (const row of batch.items) {
      expect(row.source).toBe('osm');
      expect(row.record_id).toMatch(/^node\/\d+$/);
      expect(row.index_partition).toBe('AZ');
      expect(row.values.classification).toBe('mapped');
      expect(row.values.naics).toBeNull();
      expect(row.values.latitude).not.toBeNull();
    }
    if (process.env.CRM_PUBLIC_RESEARCH_FULL_INDEX_QA_ALLOWED === '1') {
      let current = batch, runs = 1, points = batch.items.length;
      while (!current.complete && runs < 60) {
        const next = await directoryBatch({ provider: 'osm', state: 'AZ', cursor: current.cursor, building_version: current.version }, AbortSignal.timeout(40000));
        expect(next.version).toBe(batch.version);
        expect(next.cursor).toBeGreaterThan(current.cursor);
        points += next.items.length; current = next; runs++;
      }
      expect(current.complete).toBe(true);
      expect(points).toBeLessThanOrEqual(50000);
      console.log(`Verified complete AZ public point index: ${current.cursor} bytes, ${points} business observations, ${runs} bounded resumable batches.`);
    }
  }, process.env.CRM_PUBLIC_RESEARCH_FULL_INDEX_QA_ALLOWED === '1' ? 600000 : 45000);
  it('streams actual official employer-plan filings without retaining signer or preparer fields', async () => {
    const batch = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(40000), Date.now() + 22000);
    console.log(`Form 5500 batch scanned ${batch.cursor} national rows for ${batch.items.length} AZ filings (complete: ${batch.complete}).`);
    expect(batch.cursor).toBeGreaterThan(2500);
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.some((item) => item.values.benefits?.contracts?.length)).toBe(true);
    for (const row of batch.items) {
      expect(row.source).toBe('dol_5500');
      expect(row.values.state).toBe('AZ');
      expect(row.values.ein).toMatch(/^\d{9}$/);
      expect(row.values.benefits).toBeDefined();
      expect(JSON.stringify(row)).not.toContain('SPONS_SIGNED_NAME');
    }
  }, 45000);
  it('matches an actual nonprofit XML filing and extracts dated aggregate figures from only its ZIP member', async () => {
    const batch = await directoryBatch({ provider: 'irs', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(40000));
    const eins = batch.items.map((item) => item.values.ein).filter((ein): ein is string => Boolean(ein));
    if (!eins.length) throw new Error('No nonprofit organization was available in the first bounded state batch.');
    const filings = await findIrsFilings(eins, AbortSignal.timeout(40000)), row = batch.items.find((item) => item.values.ein && filings.has(item.values.ein));
    if (!row?.values.ein) throw new Error('No organization in the actual Arizona batch has a supported current 990 XML filing.');
    const filing = filings.get(row.values.ein);
    if (!filing) throw new Error('The selected actual Arizona organization has no current supported 990 XML filing.');
    const result = await readIrsFinancials(row.values.ein, filing, AbortSignal.timeout(30000));
    expect(result.ein).toBe(row.values.ein);
    expect(result.period_end.slice(0, 7).replace('-', '')).toBe(filing.tax_period);
    expect([result.revenue, result.assets, result.expenses, result.employees].some((value) => value !== null)).toBe(true);
  }, 120000);
  it('finds actual nonprofit businesses by territory without a known business name or CRM lookup', async () => {
    const rows = await searchIrs({ ...EMPTY_BUSINESS_SEARCH, industry: 'nonprofit', state: 'AZ', city: 'Tucson' }, 0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(25);
    for (const row of rows) {
      expect(row.source).toBe('irs');
      expect(row.values.state).toBe('AZ');
      expect(row.values.city?.toUpperCase()).toBe('TUCSON');
      expect(row.record_id).toMatch(/^\d{9}$/);
      expect(row.values.name.length).toBeGreaterThan(0);
      expect(row.values.naics).toBeNull();
    }
  }, 60000);
  it('finds actual registered fleets by territory without QCMobile credentials or a known business name', async () => {
    const rows = await searchCensus({ ...EMPTY_BUSINESS_SEARCH, industry: 'trucking', state: 'AZ', city: 'Tucson' }, 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe('fmcsa_census');
      expect(row.values.state).toBe('AZ');
      expect(row.values.city?.toUpperCase()).toBe('TUCSON');
      expect(row.values.dot).toMatch(/^\d+$/);
      expect(row.values.naics).toBeNull();
      expect(row.source_as_of).toBeNull();
    }
  }, 60000);
});
