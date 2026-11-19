import { inflateRawSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { BusinessObservation, ResearchFinancials } from '@crm/shared';
import { validEvidenceDate } from '@crm/shared';
import { isRecord } from './workspace-validation';

type Filing = NonNullable<BusinessObservation['values']['filing_document']>;
export function irsFilingUrl(filing: Filing): string {
  if (!/^\d{18}$/.test(filing.object_id) || !/^\d{4}_TEOS_XML_[A-Z0-9]+$/.test(filing.batch)) throw new Error('IRS filing archive identity is invalid.');
  return `https://apps.irs.gov/pub/epostcard/990/xml/${filing.batch.slice(0, 4)}/${filing.batch}.zip`;
}
export function matchesIrsFinancials(financials: ResearchFinancials | undefined, ein: string, filing: Filing): financials is ResearchFinancials {
  return Boolean(financials && financials.ein === ein && financials.object_id === filing.object_id
    && financials.return_type === filing.return_type && financials.period_end.slice(0, 7).replace('-', '') === filing.tax_period
    && financials.url === irsFilingUrl(filing));
}
function amount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))
    || Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER) throw new Error('IRS XML aggregate amount is unsupported.');
  return Number(value);
}
const group = (value: unknown): Record<string, unknown> => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('IRS XML aggregate group is unsupported.');
  return value;
};
export function parseIrsFinancials(xml: string, ein: string, filing: Filing): ResearchFinancials {
  if (Buffer.byteLength(xml) > 16 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('IRS filing XML is invalid or exceeds the safe parsing budget.');
  const parsed: unknown = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml);
  if (!isRecord(parsed) || !isRecord(parsed.Return) || !isRecord(parsed.Return.ReturnHeader) || !isRecord(parsed.Return.ReturnData)) throw new Error('IRS filing XML envelope is unsupported.');
  const header = parsed.Return.ReturnHeader, filer = group(header.Filer), period = header.TaxPeriodEndDt;
  if (!/^\d{9}$/.test(ein) || filer.EIN !== ein || header.ReturnTypeCd !== filing.return_type || typeof period !== 'string'
    || !validEvidenceDate(period) || period.slice(0, 7).replace('-', '') !== filing.tax_period) throw new Error('IRS XML does not corroborate the exact organizational EIN, return type and tax period.');
  const body = group(parsed.Return.ReturnData[`IRS${filing.return_type}`]);
  let revenue: number | null, assets: number | null, expenses: number | null, employees: number | null = null;
  if (filing.return_type === '990') {
    revenue = amount(body.CYTotalRevenueAmt); expenses = amount(body.CYTotalExpensesAmt);
    assets = amount(group(body.TotalAssetsGrp).EOYAmt); employees = amount(body.TotalEmployeeCnt);
    if (employees !== null && (!Number.isSafeInteger(employees) || employees < 0)) throw new Error('IRS reported employee count is invalid.');
  } else if (filing.return_type === '990EZ') {
    revenue = amount(body.TotalRevenueAmt); expenses = amount(body.TotalExpensesAmt);
    assets = amount(group(body.Form990TotalAssetsGrp).EOYAmt);
  } else {
    const analysis = group(body.AnalysisOfRevenueAndExpenses), balance = group(body.BalanceSheets);
    revenue = amount(analysis.TotalRevAndExpnssAmt); expenses = amount(analysis.TotalExpensesRevAndExpnssAmt);
    assets = amount(balance.TotAssetsEOYAmt);
  }
  if ([revenue, assets, expenses, employees].every((value) => value === null)) throw new Error('IRS XML has no supported aggregate financial fields.');
  return { ein, period_end: period, return_type: filing.return_type, object_id: filing.object_id, revenue, assets, expenses, employees,
    url: irsFilingUrl(filing) };
}
async function readRange(url: string, range: string, maximum: number, signal: AbortSignal, validator?: string): Promise<{ data: Buffer; version: string; total: number }> {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { 'User-Agent': 'Shield-Assurance-CRM/1.0 (+https://shield-assurance-crm.vercel.app)',
    Range: range, ...(validator ? { 'If-Match': validator } : {}) } });
  const version = response.headers.get('etag'), content = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (response.status !== 206 || !response.body || !version || validator && version !== validator || !content
    || Number(content[2]) - Number(content[1]) + 1 > maximum || Number(content[3]) > 2 * 1024 * 1024 * 1024) {
    await response.body?.cancel(); throw new Error(`IRS archive does not support stable bounded extraction (HTTP ${response.status}).`);
  }
  const requested = range.match(/^bytes=(\d+)-(\d+)$/);
  const suffix = range.match(/^bytes=-(\d+)$/);
  if (requested && (requested[1] !== content[1] || requested[2] !== content[2])
    || suffix && (Number(content[2]) !== Number(content[3]) - 1 || Number(content[1]) !== Math.max(0, Number(content[3]) - Number(suffix[1])))) {
    await response.body.cancel(); throw new Error('IRS archive returned a different byte range.');
  }
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > maximum) throw new Error('IRS archive range exceeds its bounded budget.');
      chunks.push(Buffer.from(item.value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (size !== Number(content[2]) - Number(content[1]) + 1) throw new Error('IRS archive range is truncated.');
  return { data: Buffer.concat(chunks), version, total: Number(content[3]) };
}
export async function readIrsFinancials(ein: string, filing: Filing, signal: AbortSignal): Promise<ResearchFinancials> {
  const url = irsFilingUrl(filing), tail = await readRange(url, 'bytes=-65557', 65557, signal);
  const end = tail.data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > tail.data.length || end + 22 + tail.data.readUInt16LE(end + 20) !== tail.data.length
    || tail.data.readUInt16LE(end + 4) !== 0 || tail.data.readUInt16LE(end + 6) !== 0) throw new Error('IRS ZIP end record is unsupported.');
  const length = tail.data.readUInt32LE(end + 12), offset = tail.data.readUInt32LE(end + 16);
  if (!length || length > 4 * 1024 * 1024 || offset + length > tail.total) throw new Error('IRS ZIP directory exceeds its bounded budget.');
  const directory = await readRange(url, `bytes=${offset}-${offset + length - 1}`, 4 * 1024 * 1024, signal, tail.version);
  const filename = `${filing.object_id}_public.xml`;
  let position = 0;
  while (position < directory.data.length) {
    const b = directory.data;
    if (position + 46 > b.length || b.readUInt32LE(position) !== 0x02014b50) throw new Error('IRS ZIP directory is malformed.');
    const nameLength = b.readUInt16LE(position + 28), extra = b.readUInt16LE(position + 30), comment = b.readUInt16LE(position + 32);
    const next = position + 46 + nameLength + extra + comment;
    if (next > b.length) throw new Error('IRS ZIP member header is truncated.');
    const name = b.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (name === filename || name.endsWith(`/${filename}`)) {
      const method = b.readUInt16LE(position + 10), compressed = b.readUInt32LE(position + 20), expanded = b.readUInt32LE(position + 24), start = b.readUInt32LE(position + 42);
      if (b.readUInt16LE(position + 8) & 1 || ![0, 8].includes(method) || !compressed || compressed > 8 * 1024 * 1024
        || !expanded || expanded > 16 * 1024 * 1024 || start + 30 > tail.total) throw new Error('IRS XML member exceeds its safe extraction budget.');
      const header = await readRange(url, `bytes=${start}-${start + 29}`, 30, signal, tail.version);
      const localNameLength = header.data.readUInt16LE(26);
      if (header.data.readUInt32LE(0) !== 0x04034b50 || header.data.readUInt16LE(6) & 1 || header.data.readUInt16LE(8) !== method || !localNameLength) throw new Error('IRS XML local header disagrees with its directory.');
      const localName = await readRange(url, `bytes=${start + 30}-${start + 29 + localNameLength}`, 65535, signal, tail.version);
      if (localName.data.toString('utf8') !== name) throw new Error('IRS XML local filename disagrees with its indexed member.');
      const dataOffset = start + 30 + header.data.readUInt16LE(26) + header.data.readUInt16LE(28);
      if (dataOffset + compressed > offset) throw new Error('IRS XML data overlaps its ZIP directory.');
      const data = await readRange(url, `bytes=${dataOffset}-${dataOffset + compressed - 1}`, 8 * 1024 * 1024, signal, tail.version);
      const decoded = method === 8 ? inflateRawSync(data.data, { maxOutputLength: 16 * 1024 * 1024 }) : data.data;
      if (decoded.length !== expanded) throw new Error('IRS XML expanded size disagrees with its directory.');
      return parseIrsFinancials(decoded.toString('utf8'), ein, filing);
    }
    position = next;
  }
  throw new Error('The exact IRS filing object was not present in its indexed archive. No substitute was guessed.');
}
