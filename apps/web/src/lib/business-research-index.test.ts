import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { benefitsObservation, directoryBatch, attachPlanContract, attachIrsFiling, findIrsFilings, IRS_FILINGS_URL } from './business-research-index';
import { searchDirectory } from './business-research-index';
import { createClient } from '@supabase/supabase-js';
import { EMPTY_BUSINESS_SEARCH } from '@crm/shared';

afterEach(() => vi.unstubAllGlobals());
const sponsor = { SPONSOR_DFE_NAME: 'Synthetic Manufacturer', SPONS_DFE_EIN: '123456789', SPONS_DFE_PN: '1',
  SPONS_DFE_MAIL_US_ADDRESS1: '1 Synthetic Street', SPONS_DFE_MAIL_US_CITY: 'Tucson', SPONS_DFE_MAIL_US_STATE: 'AZ',
  SPONS_DFE_MAIL_US_ZIP: '85701', SPONS_DFE_PHONE_NUM: '5205550101', BUSINESS_CODE: '332710', PLAN_NAME: 'Synthetic pension',
  FORM_TAX_PRD: '12/31/2025', DATE_RECEIVED: '10/01/2026', TOT_PARTCP_BOY_CNT: '21', TOT_ACTIVE_PARTCP_CNT: '12',
  TYPE_PENSION_BNFT_CODE: '2J', TYPE_WELFARE_BNFT_CODE: '', ACK_ID: 'synthetic-ack', SPONS_SIGNED_NAME: 'Private Signer' };
const contractHeader = 'ACK_ID,SCH_A_EIN,SCH_A_PLAN_NUM,SCH_A_PLAN_YEAR_END_DATE,INS_CARRIER_NAME,INS_CARRIER_NAIC_CODE,INS_POLICY_FROM_DATE,INS_POLICY_TO_DATE';
function mockArchive(csv: string, etag = '"synthetic-v1"', contractCsv = `${contractHeader}\n`, contractEtag = '"synthetic-a1"'): void {
  const archive = (content: string, name: string, version: string) => {
    const compressed = deflateRawSync(Buffer.from(content)), filename = Buffer.from(name), header = Buffer.alloc(30 + filename.length);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(8, 8); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(Buffer.byteLength(content), 22); header.writeUInt16LE(filename.length, 26); filename.copy(header, 30);
    return { compressed, header, version };
  };
  const main = archive(csv, 'f_5500_2025_latest.csv', etag), schedule = archive(contractCsv, 'F_SCH_A_2025_latest.csv', contractEtag);
  vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
    const { compressed, header, version } = String(url).includes('F_SCH_A_') ? schedule : main;
    const range = new Headers(init.headers).get('Range');
    if (range === 'bytes=0-4095') return new Response(header, { status: 206, headers: { etag: version, 'Content-Length': String(header.length) } });
    expect(new Headers(init.headers).get('If-Match')).toBe(version);
    expect(range).toBe(`bytes=${header.length}-${header.length + compressed.length - 1}`);
    return new Response(compressed, { status: 206, headers: { etag: version, 'Content-Range': `bytes ${header.length}-${header.length + compressed.length - 1}/${header.length + compressed.length}` } });
  }));
}
const csv = (rows: number): string => `${Object.keys(sponsor).join(',')}\n${Array.from({ length: rows }, () => Object.values(sponsor).join(',')).join('\n')}\n`;
describe('bounded official directory ingestion', () => {
  it('retains sponsor and dated plan facts, not signer/admin details or invented employee counts', () => {
    const observation = benefitsObservation(sponsor, 'AZ');
    expect(observation?.values).toMatchObject({ ein: '123456789', naics: '332710',
      benefits: { participants: 21, active_participants: 12, period_end: '2025-12-31', received_on: '2026-10-01' } });
    expect(JSON.stringify(observation)).not.toContain('Private Signer');
    expect(JSON.stringify(observation)).not.toContain('employees');
    expect(benefitsObservation(sponsor, 'CA')).toBeNull();
  });
  it('streams a bounded filing batch, resumes by stable source version and completes without duplicating the checkpoint', async () => {
    mockArchive(csv(2501));
    const first = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    expect(first).toMatchObject({ cursor: 2500, complete: false, version: '"synthetic-v1"|ScheduleA:"synthetic-a1"' });
    expect(first.items).toHaveLength(2500);
    const next = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: first.cursor, building_version: first.version }, AbortSignal.timeout(10000));
    expect(next).toMatchObject({ cursor: 2501, complete: true });
    expect(next.items).toHaveLength(1);
    mockArchive(csv(1), '"synthetic-v2"');
    const changed = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: first.cursor, building_version: first.version }, AbortSignal.timeout(10000));
    expect(changed).toMatchObject({ cursor: 1, complete: true, version: '"synthetic-v2"|ScheduleA:"synthetic-a1"' });
    expect(changed.items).toHaveLength(1);
  });
  it('fills a batch with rows for its own state and checkpoints real progress when the time budget ends', async () => {
    const other = Object.values({ ...sponsor, SPONS_DFE_MAIL_US_STATE: 'CA' }).join(',');
    const lines = [Object.keys(sponsor).join(','), ...Array.from({ length: 3000 }, () => other), Object.values(sponsor).join(',')];
    mockArchive(`${lines.join('\n')}\n`);
    const full = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    expect(full).toMatchObject({ cursor: 3001, complete: true });
    expect(full.items).toHaveLength(1);
    mockArchive(csv(3));
    const partial = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000), 0);
    expect(partial).toMatchObject({ cursor: 1, complete: false });
  });
  it('does not publish an empty successful index for a changed CSV schema', async () => {
    mockArchive('UNKNOWN,STATE\nSynthetic,AZ\n');
    await expect(directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000))).rejects.toThrow('header changed');
  });
  it('joins only exact sponsor filings and retains dated insurer facts without broker/person fields', async () => {
    mockArchive(csv(1), '"synthetic-v1"', `${contractHeader}\nsynthetic-ack,123456789,1,12/31/2025,Synthetic Carrier,12345,01/01/2025,12/31/2025\n`);
    const first = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    expect(first.items[0].values.benefits?.contracts).toEqual([{ insurer: 'Synthetic Carrier', naic: '12345',
      policy_from: '2025-01-01', policy_to: '2025-12-31', url: expect.stringContaining('F_SCH_A_2025_Latest.zip') }]);
    const parent = benefitsObservation(sponsor, 'AZ');
    if (!parent) throw new Error('Synthetic parent must exist.');
    const parents = new Map([['synthetic-ack', parent]]);
    attachPlanContract({ ACK_ID: 'unmatched-filing', INS_CARRIER_NAME: 'Unmatched Carrier' }, parents);
    expect(parent.values.benefits?.contracts).toBeUndefined();
    expect(() => attachPlanContract({ ACK_ID: 'synthetic-ack', SCH_A_EIN: '987654321', SCH_A_PLAN_NUM: '1' }, parents)).toThrow('corroborate');
    expect(() => attachPlanContract({ ACK_ID: 'synthetic-ack', SCH_A_EIN: '123456789', SCH_A_PLAN_NUM: '2' }, parents)).toThrow('corroborate');
  });
  it('resets a filing cursor when only the contract dataset changes', async () => {
    mockArchive(csv(2501));
    const first = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    mockArchive(csv(2501), '"synthetic-v1"', `${contractHeader}\n`, '"synthetic-a2"');
    const next = await directoryBatch({ provider: 'dol_5500', state: 'AZ', cursor: first.cursor, building_version: first.version }, AbortSignal.timeout(10000));
    expect(next.cursor).toBe(2500);
    expect(next.version).toContain('"synthetic-a2"');
  });
  it('selects an exact-EIN latest indexed return without inventing an amended/current-financial status', () => {
    const parent = benefitsObservation(sponsor, 'AZ');
    if (!parent) throw new Error('Synthetic business must exist.');
    const parents = new Map([['123456789', parent]]);
    const row = { EIN: '123456789', RETURN_TYPE: '990', TAX_PERIOD: '202512', SUB_DATE: '2026', RETURN_ID: '1',
      OBJECT_ID: '202612349349300001', XML_BATCH_ID: '2026_TEOS_XML_01A' };
    attachIrsFiling(row, parents);
    attachIrsFiling({ ...row, EIN: '987654321', OBJECT_ID: '202612349349300002' }, parents);
    attachIrsFiling({ ...row, TAX_PERIOD: '202412', RETURN_ID: '99' }, parents);
    attachIrsFiling({ ...row, SUB_DATE: '2027', RETURN_ID: '2', OBJECT_ID: '202612349349300002' }, parents);
    expect(parent.values.filing_document?.object_id).toBe('202612349349300002');
    expect(parent.values.assets).toBeNull();
  });
  it('streams bounded IRS XML-index candidates and chooses the newest return for only the requested EINs', async () => {
    const headers = 'RETURN_ID,EIN,TAX_PERIOD,SUB_DATE,RETURN_TYPE,OBJECT_ID,XML_BATCH_ID';
    const rows = [
      '1,123456789,202412,2025,990,202512349349100001,2025_TEOS_XML_12A',
      '2,123456789,202512,2026,990EZ,202612349349100002,2026_TEOS_XML_01A',
      '9,987654321,202612,2026,990,202612349349100003,2026_TEOS_XML_01A',
      '3,123456789,202512,2026,990PF,202612349349100004,2026_TEOS_XML_01A',
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe(IRS_FILINGS_URL);
      return new Response(`${headers}\n${rows.join('\n')}\n`, { headers: { etag: '"irs-test-index"' } });
    }));
    const result = await findIrsFilings(['123456789'], AbortSignal.timeout(10000));
    expect(result.get('123456789')).toMatchObject({ object_id: '202612349349100004', return_type: '990PF', tax_period: '202512' });
    expect(result.has('987654321')).toBe(false);
  });
  it('applies industry codes and excludes unknown participant counts from range filtering before pagination', async () => {
    const urls: URL[] = [];
    const db = createClient('https://example.invalid', 'synthetic', { auth: { persistSession: false }, global: {
      fetch: async (input) => {
        const url = new URL(String(input)); urls.push(url);
        const data = url.pathname.includes('/rpc/') ? { active_version: 'synthetic-v1', building_version: 'synthetic-v1', cursor: 3000, status: 'complete' } : [];
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      },
    } });
    await searchDirectory(db, '168413e9-a6a4-4dff-a8bf-8f8df83dace6', 'dol_5500',
      { ...EMPTY_BUSINESS_SEARCH, industry: 'contractor', state: 'AZ', max_participants: '20', benefits: 'pension' }, 0);
    const query = urls.find((url) => url.pathname.endsWith('business_research_directory_records'));
    expect(query?.searchParams.get('or')).toBe('(business_code.like.23%)');
    expect(query?.searchParams.get('observation->values->benefits->>participants')).toBe('not.is.null');
    expect(query?.searchParams.get('observation->values->benefits->participants')).toBe('lte.20');
    expect(query?.searchParams.get('observation->values->benefits->>pension_codes')).toBe('not.is.null');
  });
});
