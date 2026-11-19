import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { matchesIrsFinancials, parseIrsFinancials, readIrsFinancials } from './business-research-irs-filing';
import type { BusinessObservation } from '@crm/shared';

const filing: NonNullable<BusinessObservation['values']['filing_document']> = {
  object_id: '202612349349300001', batch: '2026_TEOS_XML_01A', tax_period: '202512', submission_year: '2026', return_type: '990',
};
const xml = `<Return xmlns="http://www.irs.gov/efile"><ReturnHeader><Filer><EIN>123456789</EIN><PersonNm>Private Signer</PersonNm></Filer>
<ReturnTypeCd>990</ReturnTypeCd><TaxPeriodEndDt>2025-12-31</TaxPeriodEndDt></ReturnHeader><ReturnData><IRS990>
<CYTotalRevenueAmt>10000</CYTotalRevenueAmt><CYTotalExpensesAmt>9000</CYTotalExpensesAmt><TotalEmployeeCnt>0</TotalEmployeeCnt>
<TotalAssetsGrp><EOYAmt>25000</EOYAmt></TotalAssetsGrp><Form990PartVIISectionAGrp><PersonNm>Private Director</PersonNm></Form990PartVIISectionAGrp>
</IRS990></ReturnData></Return>`;
afterEach(() => vi.unstubAllGlobals());
function archive(content: string): Buffer {
  const name = Buffer.from(`${filing.object_id}_public.xml`), data = deflateRawSync(Buffer.from(content));
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(content), 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const directory = Buffer.alloc(46 + name.length);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(Buffer.byteLength(content), 24); directory.writeUInt16LE(name.length, 28); name.copy(directory, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, directory, end]);
}
describe('exact allowlisted IRS filing extraction', () => {
  it('retains dated aggregate finances and a real zero employee count without signer/director data', () => {
    const result = parseIrsFinancials(xml, '123456789', filing);
    expect(result).toMatchObject({ ein: '123456789', period_end: '2025-12-31', revenue: 10000, expenses: 9000, assets: 25000, employees: 0 });
    expect(JSON.stringify(result)).not.toContain('Private');
  });
  it('reuses cached aggregates only for the exact filing object, return type, period, and EIN', () => {
    const result = parseIrsFinancials(xml, '123456789', filing);
    expect(matchesIrsFinancials(result, '123456789', filing)).toBe(true);
    expect(matchesIrsFinancials(result, '987654321', filing)).toBe(false);
    expect(matchesIrsFinancials(result, '123456789', { ...filing, object_id: '202612349349300002' })).toBe(false);
    expect(matchesIrsFinancials(result, '123456789', { ...filing, return_type: '990EZ' })).toBe(false);
    expect(matchesIrsFinancials(result, '123456789', { ...filing, tax_period: '202412' })).toBe(false);
  });
  it('rejects mismatched identities/periods and unsafe XML rather than assigning another organization’s figures', () => {
    expect(() => parseIrsFinancials(xml, '987654321', filing)).toThrow('corroborate');
    expect(() => parseIrsFinancials(xml, '123456789', { ...filing, tax_period: '202412' })).toThrow('corroborate');
    expect(() => parseIrsFinancials(xml, '123456789', { ...filing, return_type: '990PF' })).toThrow('corroborate');
    expect(() => parseIrsFinancials(`<!DOCTYPE Return [<!ENTITY external SYSTEM "file:///private">]>${xml}`, '123456789', filing)).toThrow('invalid');
  });
  it('extracts only the exact XML member through bounded, version-conditional ZIP ranges', async () => {
    const file = archive(xml), ranges: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      const headers = new Headers(init.headers), range = headers.get('Range') ?? ''; ranges.push(range);
      const match = range.match(/^bytes=(\d+)-(\d+)$/), suffix = range.match(/^bytes=-(\d+)$/);
      const start = match ? Number(match[1]) : Math.max(0, file.length - Number(suffix?.[1]));
      const end = match ? Number(match[2]) : file.length - 1;
      if (ranges.length > 1) expect(headers.get('If-Match')).toBe('"synthetic-xml"');
      return new Response(Uint8Array.from(file.subarray(start, end + 1)), { status: 206, headers: {
        etag: '"synthetic-xml"', 'Content-Range': `bytes ${start}-${end}/${file.length}`,
      } });
    }));
    expect((await readIrsFinancials('123456789', filing, AbortSignal.timeout(10000))).assets).toBe(25000);
    expect(ranges[0]).toBe('bytes=-65557');
    expect(ranges).toHaveLength(5);
  });
});
