import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { parse } from 'csv-parse';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RESEARCH_INDUSTRIES, RESEARCH_NAICS, researchNaicsCategory, type BusinessObservation, type BusinessSearchFilters } from '@crm/shared';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { validEvidenceDate } from '@crm/shared';
import { osmDirectoryBatch } from './business-research-osm-index';
import { RESEARCH_OSM_EXTRACTS } from '../data/research-osm-extracts';
import { researchIndustry } from './business-research';
import { radiusCities, researchPlace } from './research-geography';
import type { Territory } from './business-research-sources';

const DOL_URL = 'https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_2025_Latest.zip';
const DOL_CONTRACTS_URL = 'https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_SCH_A_2025_Latest.zip';
export const IRS_FILINGS_URL = `https://apps.irs.gov/pub/epostcard/990/xml/${new Date().getUTCFullYear()}/index_${new Date().getUTCFullYear()}.csv`;
const ua = 'Shield-Assurance-CRM/1.0 (+https://shield-assurance-crm.vercel.app)';
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const count = (value: unknown): number | null => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
function day(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10)
    : /^\d{2}\/\d{2}\/\d{4}/.test(raw) ? `${raw.slice(6, 10)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}` : null;
  return validEvidenceDate(date) ? date : null;
}
export function benefitsObservation(row: Record<string, unknown>, state: string): BusinessObservation | null {
  const local = Boolean(text(row.SPONS_DFE_LOC_US_STATE));
  const prefix = local ? 'SPONS_DFE_LOC_US_' : 'SPONS_DFE_MAIL_US_';
  if (text(row[`${prefix}STATE`]) !== state) return null;
  const name = text(row.SPONSOR_DFE_NAME), ein = text(row.SPONS_DFE_EIN), plan = text(row.SPONS_DFE_PN), filing = text(row.ACK_ID);
  if (!name || !ein || !/^\d{9}$/.test(ein) || !plan || !/^\d{1,3}$/.test(plan) || !filing || filing.length > 30) throw new Error('Form 5500 sponsor identity is unsupported.');
  const period = day(row.FORM_TAX_PRD), received = day(row.DATE_RECEIVED), businessCode = text(row.BUSINESS_CODE);
  const code = businessCode && RESEARCH_NAICS.some((item) => item.code === businessCode) ? businessCode : null;
  return { source: 'dol_5500', record_id: `${ein}:${plan.padStart(3, '0')}:2025`, url: DOL_URL,
    fetched_at: new Date().toISOString(), source_as_of: period, values: {
      name, street: [text(row[`${prefix}ADDRESS1`]), text(row[`${prefix}ADDRESS2`])].filter(Boolean).join(' ') || null,
      city: text(row[`${prefix}CITY`]), state, zip: text(row[`${prefix}ZIP`]), phone: text(row.SPONS_DFE_PHONE_NUM),
      email: null, website: null, latitude: null, longitude: null, industry: code ? RESEARCH_NAICS.find((item) => item.code === code)?.title ?? null : null,
      naics: code, classification: 'reported', dot: null, ein, power_units: null, drivers: null, registration_reported_on: null,
      filing_year: period?.slice(0, 4) ?? null, assets: null, revenue: null, benefits: {
        plan_name: text(row.PLAN_NAME) ?? 'Plan name not reported', plan_number: plan.padStart(3, '0'), period_end: period, received_on: received,
        participants: count(row.TOT_PARTCP_BOY_CNT), active_participants: count(row.TOT_ACTIVE_PARTCP_CNT),
        pension_codes: text(row.TYPE_PENSION_BNFT_CODE), welfare_codes: text(row.TYPE_WELFARE_BNFT_CODE), business_code: businessCode,
        filing_id: filing,
      },
    } };
}
function irsObservation(row: Record<string, unknown>, state: string): BusinessObservation | null {
  if (text(row.STATE) !== state) return null;
  const name = text(row.NAME), ein = text(row.EIN);
  if (!name || !ein || !/^\d{9}$/.test(ein)) throw new Error('IRS directory identity is unsupported.');
  const signedAmount = (value: unknown): number | null => typeof value === 'string' && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  return { source: 'irs', record_id: ein, url: `https://www.irs.gov/pub/irs-soi/eo_${state.toLowerCase()}.csv`,
    fetched_at: new Date().toISOString(), source_as_of: null, values: { name, street: text(row.STREET), city: text(row.CITY), state,
      zip: text(row.ZIP), phone: null, email: null, website: null, latitude: null, longitude: null, industry: 'Tax-exempt organization',
      naics: null, classification: 'reported', dot: null, ein, power_units: null, drivers: null, registration_reported_on: null,
      filing_year: text(row.TAX_PERIOD), assets: signedAmount(row.ASSET_AMT), revenue: signedAmount(row.REVENUE_AMT) } };
}
type Partition = { provider: 'irs' | 'dol_5500' | 'osm'; state: string; cursor: number; building_version: string | null; active_version: string | null; lease: string; status: string; error: string | null };
async function request(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, { signal, headers: { 'User-Agent': ua, ...headers }, cache: 'no-store' });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Official directory download returned HTTP ${response.status}.`); }
  return response;
}
async function* chunks(response: Response, maximum: number): AsyncGenerator<Buffer> {
  if (!response.body) throw new Error('Official directory response has no body.');
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) throw new Error('Official directory exceeds the bounded streaming budget.');
      yield Buffer.from(next.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
async function archiveInput(url: string, filename: string, header: Response, signal: AbortSignal): Promise<Readable> {
  const validator = header.headers.get('etag') ?? header.headers.get('last-modified');
  if (!validator || header.status !== 206 || Number(header.headers.get('content-length')) > 4096) {
    await header.body?.cancel(); throw new Error('Form 5500 does not support stable bounded range reads.');
  }
  const bytes = Buffer.from(await header.arrayBuffer());
  if (bytes.length < 30 || bytes.length > 4096 || bytes.readUInt32LE(0) !== 0x04034b50 || bytes.readUInt16LE(6) !== 0
    || bytes.readUInt16LE(8) !== 8) throw new Error('Form 5500 archive compression changed.');
  const length = bytes.readUInt32LE(18), offset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  if (!length || length > 40 * 1024 * 1024 || offset > bytes.length
    || bytes.subarray(30, 30 + bytes.readUInt16LE(26)).toString('utf8') !== filename) throw new Error('Form 5500 archive layout exceeds the bounded processor.');
  const conditions: Record<string, string> = header.headers.get('etag') ? { 'If-Match': validator } : { 'If-Unmodified-Since': validator };
  const response = await request(url, signal, { Range: `bytes=${offset}-${offset + length - 1}`, ...conditions });
  if (response.status !== 206 || response.headers.get('content-range')?.split('/')[0] !== `bytes ${offset}-${offset + length - 1}`
    || (response.headers.get('etag') ?? response.headers.get('last-modified')) !== validator) {
    await response.body?.cancel(); throw new Error('Form 5500 changed during its range download.');
  }
  return Readable.from(chunks(response, 40 * 1024 * 1024));
}
export function attachPlanContract(row: Record<string, unknown>, parents: Map<string, BusinessObservation>): void {
  const filing = text(row.ACK_ID), parent = filing ? parents.get(filing) : undefined;
  if (!parent?.values.benefits) return;
  const benefits = parent.values.benefits, ein = text(row.SCH_A_EIN), plan = text(row.SCH_A_PLAN_NUM), period = day(row.SCH_A_PLAN_YEAR_END_DATE);
  if (ein !== parent.values.ein || !plan || plan.padStart(3, '0') !== benefits.plan_number
    || period && benefits.period_end && period !== benefits.period_end) throw new Error('Schedule A does not corroborate its exact sponsor filing identity.');
  const contracts = benefits.contracts ??= [];
  const naic = text(row.INS_CARRIER_NAIC_CODE);
  const contract = { insurer: text(row.INS_CARRIER_NAME), naic: naic && /^\d{5}$/.test(naic) ? naic : null,
    policy_from: day(row.INS_POLICY_FROM_DATE), policy_to: day(row.INS_POLICY_TO_DATE), url: DOL_CONTRACTS_URL };
  if (contracts.some((item) => JSON.stringify(item) === JSON.stringify(contract))) return;
  if (contracts.length >= 200) throw new Error('Sponsor filing exceeds the bounded benefit-contract budget.');
  contracts.push(contract);
}
async function scanSecondaryCsv(input: Readable, transforms: Transform[], required: string[], visit: (row: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
  let decoded = 0;
  const budget = new Transform({ transform(value: Buffer, _encoding, callback) {
    decoded += value.length;
    callback(decoded > 256 * 1024 * 1024 ? new Error('Expanded filing data exceeds its bounded processor.') : null, value);
  } });
  const rows = parse({ columns: (columns: string[]) => {
    if (required.some((field) => !columns.includes(field))) throw new Error('Secondary filing CSV header changed.');
    return columns;
  }, bom: true, skip_empty_lines: true, max_record_size: 65536 });
  let streamError: unknown;
  const completed = pipeline([input, ...transforms, budget, rows], { signal }).catch((error: unknown) => { streamError = error; });
  try {
    for await (const row of rows) {
      if (!isRecord(row)) throw new Error('Filing CSV contains an unsupported record.');
      visit(row);
    }
    await completed;
    if (streamError) throw streamError;
  } finally {
    input.destroy(); rows.destroy(); await completed;
  }
}
async function planContracts(items: BusinessObservation[], header: Response, signal: AbortSignal): Promise<void> {
  if (!items.length) { await header.body?.cancel(); return; }
  const parents = new Map<string, BusinessObservation>();
  for (const item of items) {
    const benefits = item.values.benefits;
    if (!benefits?.filing_id) throw new Error('Schedule A enrichment requires the exact sponsor filing identifier.');
    benefits.contracts = []; parents.set(benefits.filing_id, item);
  }
  const input = await archiveInput(DOL_CONTRACTS_URL, 'F_SCH_A_2025_latest.csv', header, signal);
  await scanSecondaryCsv(input, [createInflateRaw()], ['ACK_ID', 'SCH_A_EIN', 'SCH_A_PLAN_NUM', 'INS_CARRIER_NAME', 'INS_POLICY_FROM_DATE', 'INS_POLICY_TO_DATE'],
    (row) => attachPlanContract(row, parents), signal);
  for (const item of items) item.values.benefits?.contracts?.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function attachIrsFiling(row: Record<string, unknown>, parents: Map<string, BusinessObservation>): void {
  const ein = text(row.EIN), parent = ein ? parents.get(ein) : undefined;
  if (!parent) return;
  const type = text(row.RETURN_TYPE);
  if (type !== '990' && type !== '990EZ' && type !== '990PF') return;
  const object = text(row.OBJECT_ID), batch = text(row.XML_BATCH_ID), period = text(row.TAX_PERIOD), submitted = text(row.SUB_DATE);
  if (!object || !/^\d{18}$/.test(object) || !batch || !/^\d{4}_TEOS_XML_[A-Z0-9]+$/.test(batch)
    || !period || !/^\d{4}(0[1-9]|1[0-2])$/.test(period) || !submitted || !/^\d{4}$/.test(submitted)) {
    const flags = { period: Boolean(period && /^\d{4}(0[1-9]|1[0-2])$/.test(period)),
      submission_year: Boolean(submitted && /^\d{4}$/.test(submitted)),
      object_id: Boolean(object && /^\d{18}$/.test(object)), batch: Boolean(batch && /^\d{4}_TEOS_XML_[A-Z0-9]+$/.test(batch)) };
    throw new Error(`IRS filing index identity or submission year is unsupported (${JSON.stringify(flags)}).`);
  }
  const previous = parent.values.filing_document;
  const next: NonNullable<BusinessObservation['values']['filing_document']> = { object_id: object, batch, tax_period: period, submission_year: submitted, return_type: type };
  if (!previous || period > previous.tax_period || period === previous.tax_period && (submitted > previous.submission_year
    || submitted === previous.submission_year && object > previous.object_id)) parent.values.filing_document = next;
}
export async function findIrsFilings(eins: readonly string[], signal: AbortSignal): Promise<Map<string, NonNullable<BusinessObservation['values']['filing_document']>>> {
  if (!eins.length || eins.length > 2500 || eins.some((ein) => !/^\d{9}$/.test(ein))) throw new Error('IRS filing lookup requires a bounded set of exact organizational EINs.');
  const targets = new Set(eins), found = new Map<string, Record<string, unknown>>();
  const response = await request(IRS_FILINGS_URL, signal), version = response.headers.get('etag') ?? response.headers.get('last-modified');
  if (!version) { await response.body?.cancel(); throw new Error('IRS filing index has no stable version validator.'); }
  const required = ['EIN', 'TAX_PERIOD', 'SUB_DATE', 'RETURN_TYPE', 'OBJECT_ID', 'XML_BATCH_ID'];
  const rows = parse({ columns: (columns: string[]) => {
    if (required.some((field) => !columns.includes(field))) throw new Error('IRS filing-index schema changed.');
    return columns;
  }, bom: true, skip_empty_lines: true, max_record_size: 65536 });
  const combined = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  let streamError: unknown, cursor = 0, selected: Record<string, unknown> | null = null;
  const completed = pipeline([Readable.from(chunks(response, 64 * 1024 * 1024)), rows], { signal: combined })
    .catch((error: unknown) => { streamError = error; });
  try {
    for await (const value of rows) {
      cursor++;
      if (cursor > 1_500_000 || !isRecord(value)) throw new Error('IRS filing index exceeds its supported row budget.');
      const ein = text(value.EIN);
      if (!ein || !targets.has(ein)) continue;
      const type = text(value.RETURN_TYPE);
      if (!['990', '990EZ', '990PF'].includes(String(type))) continue;
      const period = text(value.TAX_PERIOD), date = text(value.SUB_DATE), object = text(value.OBJECT_ID);
      if (!period || !/^\d{4}(0[1-9]|1[0-2])$/.test(period) || !date || !/^\d{4}$/.test(date) || !object || !/^\d{18}$/.test(object)) {
        const flags = { period: Boolean(period && /^\d{4}(0[1-9]|1[0-2])$/.test(period)),
          submission_year: Boolean(date && /^\d{4}$/.test(date)), object_id: Boolean(object && /^\d{18}$/.test(object)) };
        throw new Error(`IRS filing index returned an invalid exact-EIN record (${JSON.stringify(flags)}).`);
      }
      const selected = found.get(ein);
      const previousObject = selected ? text(selected.OBJECT_ID) : null;
      if (!selected || period > String(selected.TAX_PERIOD) || period === selected.TAX_PERIOD
        && (date > String(selected.SUB_DATE) || date === selected.SUB_DATE && previousObject !== null && object > previousObject)) found.set(ein, value);
    }
    await completed;
    if (streamError) throw streamError;
  } finally {
    rows.destroy(); await completed;
  }
  const documents = new Map<string, NonNullable<BusinessObservation['values']['filing_document']>>();
  for (const [ein, row] of found) {
    const parents = new Map<string, BusinessObservation>([[ein, {
      source: 'irs', record_id: ein, url: '', fetched_at: new Date().toISOString(), source_as_of: null,
      values: { name: '', street: null, city: null, state: null, zip: null, phone: null, email: null, website: null,
        latitude: null, longitude: null, industry: null, naics: null, classification: 'unknown', dot: null, ein,
        power_units: null, drivers: null, registration_reported_on: null, filing_year: null, assets: null, revenue: null },
    }]]);
    attachIrsFiling(row, parents);
    const document = parents.get(ein)?.values.filing_document;
    if (document) documents.set(ein, document);
  }
  return documents;
}
export async function findIrsFiling(ein: string, signal: AbortSignal): Promise<NonNullable<BusinessObservation['values']['filing_document']> | null> {
  return (await findIrsFilings([ein], signal)).get(ein) ?? null;
}
export async function directoryBatch(part: Pick<Partition, 'provider' | 'state' | 'cursor' | 'building_version'>, signal: AbortSignal,
  deadline = Number.POSITIVE_INFINITY): Promise<{
  version: string; cursor: number; complete: boolean; items: BusinessObservation[];
}> {
  if (part.provider === 'osm') return osmDirectoryBatch(part, signal);
  const url = part.provider === 'dol_5500' ? DOL_URL : `https://www.irs.gov/pub/irs-soi/eo_${part.state.toLowerCase()}.csv`;
  const response = await request(url, signal, part.provider === 'dol_5500' ? { Range: 'bytes=0-4095' } : {});
  let version = response.headers.get('etag') ?? response.headers.get('last-modified');
  if (!version) { await response.body?.cancel(); throw new Error('Official directory has no stable version validator.'); }
  let contractsHeader: Response | null = null;
  try {
    if (part.provider === 'dol_5500') contractsHeader = await request(DOL_CONTRACTS_URL, signal, { Range: 'bytes=0-4095' });
  } catch (error) { await response.body?.cancel(); throw error; }
  if (contractsHeader) {
    const contractVersion = contractsHeader.headers.get('etag') ?? contractsHeader.headers.get('last-modified');
    if (!contractVersion) { await response.body?.cancel(); await contractsHeader.body?.cancel(); throw new Error('Secondary filings have no stable version validator.'); }
    version += `|ScheduleA:${contractVersion}`;
  }
  const start = version === part.building_version ? part.cursor : 0;
  let input: Readable;
  const transforms: Transform[] = [];
  if (part.provider === 'dol_5500') {
    try { input = await archiveInput(url, 'f_5500_2025_latest.csv', response, signal); }
    catch (error) { await contractsHeader?.body?.cancel(); throw error; }
    transforms.push(createInflateRaw());
  } else input = Readable.from(chunks(response, 64 * 1024 * 1024));
  let decoded = 0;
  transforms.push(new Transform({ transform(bytes: Buffer, _encoding, callback) {
    decoded += bytes.byteLength;
    if (decoded > 256 * 1024 * 1024) callback(new Error('Expanded directory exceeds the bounded processor.'));
    else callback(null, bytes);
  } }));
  const required = part.provider === 'dol_5500' ? ['ACK_ID', 'SPONSOR_DFE_NAME', 'SPONS_DFE_EIN', 'SPONS_DFE_PN', 'BUSINESS_CODE', 'DATE_RECEIVED', 'FORM_TAX_PRD']
    : ['EIN', 'NAME', 'STATE', 'TAX_PERIOD', 'REVENUE_AMT'];
  const rows = parse({ columns: (columns: string[]) => {
    if (required.some((field) => !columns.includes(field))) throw new Error('Official directory CSV header changed.');
    return columns;
  }, bom: true, skip_empty_lines: true, max_record_size: 65536 });
  const cancel = new AbortController();
  let streamError: unknown;
  const completed = pipeline([input, ...transforms, rows], { signal: cancel.signal }).catch((error: unknown) => { streamError = error; });
  let cursor = 0, complete = true;
  const items: BusinessObservation[] = [];
  let readError: unknown;
  try {
    for await (const value of rows) {
      if (!isRecord(value)) throw new Error('Official directory CSV has an unsupported record.');
      cursor++;
      if (cursor <= start) continue;
      const item = part.provider === 'dol_5500' ? benefitsObservation(value, part.state) : irsObservation(value, part.state);
      if (item) items.push(item);
      // National files hold few rows per state, so a batch keeps scanning until it fills or its time budget ends; each checkpoint then saves real progress.
      if (items.length >= 2500 || Date.now() >= deadline) { complete = false; break; }
    }
    if (cursor < start) throw new Error('Official directory version no longer contains its saved checkpoint.');
  } catch (error) { readError = error; throw error;
  } finally {
    cancel.abort(); await completed;
    if (readError) await contractsHeader?.body?.cancel();
    if (!readError && streamError && !(streamError instanceof Error && 'code' in streamError && streamError.code === 'ABORT_ERR')) {
      await contractsHeader?.body?.cancel(); throw streamError;
    }
  }
  if (contractsHeader) await planContracts(items, contractsHeader, signal);
  return { version, cursor, complete, items };
}
export async function searchOsmDirectory(db: SupabaseClient, actor: string, filters: BusinessSearchFilters, page: number,
  bounds: () => Promise<Territory>): Promise<{ rows: BusinessObservation[]; message: string }> {
  let part: Partition | null = null;
  if (filters.state) {
    if (!RESEARCH_OSM_EXTRACTS[filters.state]) throw new WorkspaceError('No public OSM state extract supports this territory.', 400);
    const queued = await db.rpc('queue_business_research_partition', { p_actor: actor, p_provider: 'osm', p_state: filters.state }).single<Partition>();
    if (queued.error) throw databaseError(queued.error);
    part = queued.data;
    if (!part) throw new WorkspaceError('Open-map index status could not be verified.', 503);
  }
  if (part && !part.active_version && !part.building_version) {
    if (part.status === 'failed') throw new WorkspaceError(part.error ?? 'Open-map indexing failed.', 503);
    return { rows: [], message: `Open-map businesses are indexing for ${filters.state}. The background index will supply mapped point locations; area-only features are not included.` };
  }
  const category = filters.naics ? researchNaicsCategory(filters.naics)?.osm : researchIndustry(filters)?.osm;
  const center = filters.radius_miles && filters.place_id ? researchPlace(filters.state, filters.place_id) : null;
  const result = await db.rpc('browse_business_research_map_index', { p_actor: actor, p_state: filters.state,
    p_city: filters.radius_miles || filters.map_bounds ? '' : filters.city,
    p_bounds: filters.radius_miles || filters.map_bounds ? await bounds() : null,
    p_query: filters.query, p_tag_key: category?.[0] ?? null, p_tag_pattern: category?.[1] ?? null,
    p_zip: filters.zip, p_contact: filters.contact, p_latitude: center?.latitude ?? null, p_longitude: center?.longitude ?? null,
    p_radius_miles: center ? Number(filters.radius_miles) : null, p_page: page }).select('observation').returns<Array<{ observation: BusinessObservation }>>();
  if (result.error) throw databaseError(result.error);
  if (!Array.isArray(result.data)) throw new WorkspaceError('Indexed map search returned an unsupported response.', 503);
  return { rows: result.data.map((row) => row.observation), message: 'OpenStreetMap contributors · ODbL; Geofabrik public extracts. Mapped point locations only, not a complete business directory or reported NAICS.'
    + (!part ? ' Browsing available indexed states; coverage is not nationwide.'
      : part.status !== 'complete' ? ` Indexing is incomplete (${part.cursor.toLocaleString()} bytes scanned).` : ' Source partition indexed.')
    + (part?.status === 'failed' ? ` Refresh failed: ${part.error}` : '') };
}
export async function runDirectoryIndexJob(db: SupabaseClient): Promise<{ processed: number; failed: number }> {
  const claimed = await db.rpc('claim_business_research_partition').single<Partition | null>();
  if (claimed.error) throw databaseError(claimed.error);
  const part = claimed.data;
  if (!part) return { processed: 0, failed: 0 };
  try {
    const batch = await directoryBatch(part, AbortSignal.timeout(48000), Date.now() + (part.provider === 'dol_5500' ? 26000 : 30000));
    const saved = await db.rpc('finish_business_research_partition', { p_provider: part.provider, p_state: part.state, p_lease: part.lease,
      p_version: batch.version, p_cursor: batch.cursor, p_complete: batch.complete, p_items: batch.items, p_error: null });
    if (saved.error) throw databaseError(saved.error);
    return { processed: saved.data === true ? 1 : 0, failed: 0 };
  } catch (error) {
    console.error('[business-research-directory]', part.provider, part.state, error);
    const saved = await db.rpc('finish_business_research_partition', { p_provider: part.provider, p_state: part.state, p_lease: part.lease,
      p_version: null, p_cursor: part.cursor, p_complete: false, p_items: [], p_error: error instanceof Error ? error.message : 'Directory indexing failed.' });
    if (saved.error) throw databaseError(saved.error);
    return { processed: 0, failed: 1 };
  }
}
export async function searchDirectory(db: SupabaseClient, actor: string, provider: 'irs' | 'dol_5500', filters: BusinessSearchFilters, page: number): Promise<{
  rows: BusinessObservation[]; message: string;
}> {
  const queued = await db.rpc('queue_business_research_partition', { p_actor: actor, p_provider: provider, p_state: filters.state }).single<Partition>();
  if (queued.error) throw databaseError(queued.error);
  if (!queued.data) throw new WorkspaceError('Directory indexing status could not be verified.', 503);
  const part = queued.data, version = part.active_version ?? part.building_version;
  if (!['', 'phone', 'any'].includes(filters.contact)) throw new WorkspaceError('This directory cannot establish the selected contact filter.', 400);
  if (!version) {
    if (part.status === 'failed') throw new WorkspaceError(part.error ?? 'Official directory indexing failed.', 503);
    return { rows: [], message: `Official ${provider === 'irs' ? 'IRS' : 'Form 5500'} records are indexing for ${filters.state}. Search again as the background index advances.` };
  }
  let query = db.from('business_research_directory_records').select('observation').eq('provider', provider).eq('state', filters.state).eq('version', version);
  if (filters.query) query = query.ilike('name', `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  const nearby = radiusCities(filters);
  if (nearby) {
    if (!nearby.length) return { rows: [], message: 'No reported filing city falls inside this radius.' };
    query = query.in('city', nearby);
  } else if (filters.city) query = query.eq('city', filters.city.toUpperCase());
  if (filters.zip) query = query.eq('zip', filters.zip);
  if (provider === 'dol_5500') {
    const prefixes: readonly string[] = filters.naics ? [filters.naics] : RESEARCH_INDUSTRIES.find((item) => item.id === filters.industry)?.naics ?? [];
    const clauses = prefixes.flatMap((prefix) => {
      const sectors = prefix.includes('-') ? prefix.split('-').map(Number) : [];
      return sectors.length ? Array.from({ length: sectors[1] - sectors[0] + 1 }, (_, i) => `business_code.like.${sectors[0] + i}%`) : [`business_code.like.${prefix}%`];
    });
    if (clauses.length) query = query.or(clauses.join(','));
  }
  if (filters.contact === 'phone' || filters.contact === 'any') query = query.not('observation->values->>phone', 'is', null);
  if (filters.min_revenue || filters.max_revenue) query = query.not('observation->values->>revenue', 'is', null);
  if (filters.min_revenue) query = query.gte('observation->values->revenue', Number(filters.min_revenue));
  if (filters.max_revenue) query = query.lte('observation->values->revenue', Number(filters.max_revenue));
  if (filters.benefits === 'pension') query = query.not('observation->values->benefits->>pension_codes', 'is', null);
  if (filters.benefits === 'welfare') query = query.not('observation->values->benefits->>welfare_codes', 'is', null);
  if (filters.benefits === 'any') query = query.or('observation->values->benefits->>pension_codes.not.is.null,observation->values->benefits->>welfare_codes.not.is.null');
  if (filters.min_participants || filters.max_participants) query = query.not('observation->values->benefits->>participants', 'is', null);
  if (filters.min_participants) query = query.gte('observation->values->benefits->participants', Number(filters.min_participants));
  if (filters.max_participants) query = query.lte('observation->values->benefits->participants', Number(filters.max_participants));
  const result = await query.order('record_id').range(page * 25, page * 25 + 24).returns<Array<{ observation: BusinessObservation }>>();
  if (result.error) throw databaseError(result.error);
  return { rows: result.data.map(({ observation }) => observation),
    message: `${provider === 'irs' ? 'IRS nonprofit filing history' : 'Form 5500 sponsor and plan history; participants are not employee counts'}.`
      + (part.status !== 'complete' ? ` Indexing is incomplete (${part.cursor} filing rows scanned).` : ' Source partition indexed.')
      + (part.status === 'failed' ? ` Refresh failed: ${part.error}` : '') };
}

export async function refreshDirectoryObservation(db: SupabaseClient, previous: BusinessObservation): Promise<BusinessObservation> {
  const state = previous.index_partition ?? previous.values.state;
  if (!state) throw new Error('Official directory refresh requires the source state.');
  const partition = await db.from('business_research_partitions').select('active_version,building_version')
    .eq('provider', previous.source).eq('state', state).single<{ active_version: string | null; building_version: string | null }>();
  if (partition.error) throw databaseError(partition.error);
  const version = partition.data.active_version ?? partition.data.building_version;
  if (!version) throw new Error('Official directory is still indexing.');
  const result = await db.from('business_research_directory_records').select('observation').eq('provider', previous.source).eq('state', state)
    .eq('version', version).eq('record_id', previous.record_id).single<{ observation: BusinessObservation }>();
  if (result.error) throw databaseError(result.error);
  return { ...result.data.observation, fetched_at: new Date().toISOString() };
}
