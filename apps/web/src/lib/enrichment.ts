/**
 * Public-records enrichment: pulls deep safety and compliance data for a lead
 * directly from government sources and stores it on the lead profile.
 *
 * Sources:
 * - FMCSA QCMobile API (free WebKey: https://mobile.fmcsa.dot.gov/QCDevsite/ via Login.gov)
 *   env: FMCSA_WEBKEY
 * - US DOL Enforcement API v4, OSHA datasets (free key: https://dataportal.dol.gov/registration)
 *   env: DOL_API_KEY
 */
import { isRecord } from './workspace-validation';

export interface FmcsaCandidate {
  dot_number: string;
  legal_name: string;
  dba_name: string | null;
  city: string | null;
  state: string | null;
  physical_address: string | null;
  phone: string | null;
  power_units: number | null;
  drivers: number | null;
  operating_status: string | null;
  safety_rating: string | null;
  inspections_total: number | null;
  crashes_total: number | null;
  fetched_at: string;
}

export interface FmcsaRecord {
  match_method?: 'name_search' | 'agent_selected_dot';
  dot_number: string;
  legal_name: string;
  dba_name: string | null;
  entity_type: string | null;
  operating_status: string | null;
  safety_rating: string | null;
  safety_rating_date: string | null;
  power_units: number | null;
  drivers: number | null;
  mcs150_date: string | null;
  physical_address: string | null;
  physical_state?: string | null;
  physical_city?: string | null;
  phone?: string | null;
  // Last-24-month roadside performance
  inspections_total: number | null;
  driver_oos_rate: number | null;
  driver_oos_national_avg: string | null;
  vehicle_oos_rate: number | null;
  vehicle_oos_national_avg: string | null;
  crashes_total: number | null;
  crashes_fatal: number | null;
  crashes_injury: number | null;
  crashes_tow: number | null;
  fetched_at: string;
}

export interface OshaInspectionRecord {
  activity_nr: string;
  establishment: string;
  city: string | null;
  state: string | null;
  street?: string | null;
  zip?: string | null;
  open_date: string | null;
  case_status: string | null;
  inspection_type: string | null;
  violations_serious: number | null;
  violations_willful: number | null;
  violations_repeat: number | null;
  violations_other: number | null;
  total_penalty: number | null;
}

export interface OshaRecord {
  match_method?: 'name_search';
  inspections: OshaInspectionRecord[];
  total_inspections: number;
  total_penalties: number;
  fetched_at: string;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function fmcsaConfigured(): boolean {
  return Boolean(process.env.FMCSA_WEBKEY?.trim());
}

export function oshaConfigured(): boolean {
  return Boolean(process.env.DOL_API_KEY?.trim());
}

const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services';

interface FmcsaCarrierPayload {
  carrier?: Record<string, unknown>;
}

function mapCarrier(carrier: Record<string, unknown>): FmcsaRecord {
  const address = [
    toText(carrier.phyStreet),
    toText(carrier.phyCity),
    toText(carrier.phyState),
    toText(carrier.phyZipcode) ?? toText(carrier.phyZip),
  ]
    .filter(Boolean)
    .join(', ');

  return {
    dot_number: String(carrier.dotNumber ?? ''),
    legal_name: toText(carrier.legalName) ?? 'Unknown',
    dba_name: toText(carrier.dbaName),
    entity_type: toText(carrier.carrierOperation && (carrier.carrierOperation as Record<string, unknown>).carrierOperationDesc),
    operating_status: toText(carrier.statusCode) === 'A' ? 'Active' : toText(carrier.statusCode),
    safety_rating: toText(carrier.safetyRating),
    safety_rating_date: toText(carrier.safetyRatingDate),
    power_units: toNumber(carrier.totalPowerUnits),
    drivers: toNumber(carrier.totalDrivers),
    mcs150_date: toText(carrier.mcs150Outdated) === 'Y' ? 'OUTDATED' : toText(carrier.mcs150Date),
    physical_address: address || null,
    physical_state: toText(carrier.phyState),
    physical_city: toText(carrier.phyCity),
    phone: toText(carrier.telephone),
    inspections_total: toNumber(carrier.driverInsp) !== null || toNumber(carrier.vehicleInsp) !== null
      ? (toNumber(carrier.driverInsp) ?? 0) + (toNumber(carrier.vehicleInsp) ?? 0)
      : null,
    driver_oos_rate: toNumber(carrier.driverOosRate),
    driver_oos_national_avg: toText(carrier.driverOosRateNationalAverage),
    vehicle_oos_rate: toNumber(carrier.vehicleOosRate),
    vehicle_oos_national_avg: toText(carrier.vehicleOosRateNationalAverage),
    crashes_total: toNumber(carrier.crashTotal),
    crashes_fatal: toNumber(carrier.fatalCrash),
    crashes_injury: toNumber(carrier.injCrash),
    crashes_tow: toNumber(carrier.towawayCrash),
    fetched_at: new Date().toISOString(),
  };
}

export async function fmcsaSearchPage(name: string, start: number): Promise<{ records: FmcsaRecord[]; next_start: number | null }> {
  const webKey = process.env.FMCSA_WEBKEY?.trim();
  if (!webKey) throw new Error('FMCSA_WEBKEY is not configured. Add the free FMCSA WebKey to server environment settings, then redeploy.');
  const params = new URLSearchParams({ webKey, start: String(start), size: '50' });
  const response = await fetch(`${FMCSA_BASE}/carriers/name/${encodeURIComponent(name)}?${params}`, {
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`FMCSA search failed (${response.status}). No search results were saved.`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.content) || payload.content.length > 50
    || !payload.content.every((item: unknown) => isRecord(item) && isRecord(item.carrier)
      && /^[1-9]\d{0,8}$/.test(String(item.carrier.dotNumber ?? '')) && Boolean(toText(item.carrier.legalName)))) {
    throw new Error('FMCSA returned an unsupported search response. No search results were saved.');
  }
  const records = payload.content.map((item: { carrier: Record<string, unknown> }) => mapCarrier(item.carrier));
  return { records, next_start: records.length === 50 ? start + 50 : null };
}

export async function fmcsaSearchByName(name: string, state?: string | null): Promise<FmcsaCandidate[]> {
  const { records } = await fmcsaSearchPage(name.slice(0, 60), 0);
  const candidates = records.map((record) => ({ dot_number: record.dot_number, legal_name: record.legal_name,
    dba_name: record.dba_name, city: record.physical_city ?? null, state: record.physical_state ?? null,
    physical_address: record.physical_address, phone: record.phone ?? null, power_units: record.power_units, drivers: record.drivers,
    operating_status: record.operating_status, safety_rating: record.safety_rating, inspections_total: record.inspections_total,
    crashes_total: record.crashes_total, fetched_at: record.fetched_at }));

  // Prefer same-state candidates when a state is known.
  if (state) {
    const inState = candidates.filter((candidate) => candidate.state?.toUpperCase() === state.toUpperCase());
    if (inState.length > 0) return inState.slice(0, 8);
  }
  return candidates.slice(0, 8);
}

export async function fmcsaGetCarrier(dotNumber: string): Promise<FmcsaRecord> {
  const webKey = process.env.FMCSA_WEBKEY?.trim();
  if (!webKey) throw new Error('FMCSA_WEBKEY is not configured.');

  const params = new URLSearchParams({ webKey });
  const response = await fetch(`${FMCSA_BASE}/carriers/${encodeURIComponent(dotNumber)}?${params}`, {
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`FMCSA carrier lookup failed (${response.status}).`);

  const payload = (await response.json()) as { content?: FmcsaCarrierPayload };
  const carrier = payload.content?.carrier;
  if (!carrier) throw new Error('Carrier not found.');
  return mapCarrier(carrier);
}

const DOL_BASE = 'https://apiprod.dol.gov/v4/get/OSHA';
const DOL_SPACING_MS = 1000;
const DOL_COOLDOWN_MS = 15 * 60000;
const DOL_BACKGROUND_GAP_MS = 30000;
const OSHA_CACHE_MS = 6 * 3600000;
let dolCooldownUntil = 0;
let dolLastBackground = 0;
const dolTasks: Array<{ priority: boolean; run: () => void }> = [];
let dolBusy = false;
const inspectionCache = new Map<string, { rows: Array<Record<string, unknown>>; at: number }>();

function nextDolTask(): void {
  const task = dolTasks.shift();
  dolBusy = Boolean(task);
  task?.run();
}
/** Serializes DOL requests in this server process; lookups for an open profile jump ahead of background research. */
function dolSlot<T>(task: () => Promise<T>, priority: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const entry = { priority, run: () => { void task().then(resolve, reject).finally(() => { setTimeout(nextDolTask, DOL_SPACING_MS); }); } };
    const firstBackground = priority ? dolTasks.findIndex((item) => !item.priority) : -1;
    if (firstBackground >= 0) dolTasks.splice(firstBackground, 0, entry); else dolTasks.push(entry);
    if (!dolBusy) nextDolTask();
  });
}

export function oshaCoolingDown(): boolean {
  return Date.now() < dolCooldownUntil;
}
const queuedMessage = (): string => `OSHA check queued: the Department of Labor is limiting lookups. It fills in automatically after ${new Date(dolCooldownUntil).toISOString().slice(11, 16)} UTC.`;

async function dolQuery<T>(dataset: string, filterObject: unknown, limit: number, priority = true, offset = 0): Promise<T[]> {
  const apiKey = process.env.DOL_API_KEY?.trim();
  if (!apiKey) throw new Error('DOL_API_KEY is not configured.');

  // DOL API v4 rejects the key as a header; it must be the X-API-KEY query parameter.
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    filter_object: JSON.stringify(filterObject),
    'X-API-KEY': apiKey,
  });
  const request = (): Promise<Response> => dolSlot(() => fetch(`${DOL_BASE}/${dataset}/json?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  }), priority);
  if (oshaCoolingDown()) throw new Error(queuedMessage());
  let response = await request();
  if (response.status === 429) {
    const wait = Math.min(Math.max(Number(response.headers.get('retry-after')) || 2, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    response = await request();
  }
  if (response.status === 429) {
    dolCooldownUntil = Date.now() + DOL_COOLDOWN_MS;
    throw new Error(queuedMessage());
  }
  if (!response.ok) throw new Error(`OSHA data request failed (${response.status}).`);
  const text = await response.text();
  if (response.status === 204 || !text.trim()) return [];

  const payload = JSON.parse(text) as { data?: T[] } | T[];
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.data) ? payload.data : [];
}

export interface OshaLookupOptions {
  /** Lookups for a profile a producer has open; background research is paced to protect the shared DOL quota. */
  priority?: boolean;
  /** Only inspections accepted here get the extra violation lookup. */
  match?: (inspection: OshaInspectionRecord) => boolean;
}
export async function oshaInspectionsByName(name: string | string[], state?: string | null, options: OshaLookupOptions = {}): Promise<OshaRecord> {
  const names = [...new Set((Array.isArray(name) ? name : [name]).map((entry) =>
    entry.toUpperCase().replace(/[^A-Z0-9 &]/g, ' ').replace(/\s+/g, ' ').trim()).filter((entry) => entry.length >= 3))].slice(0, 4);
  if (!names.length) throw new Error('Provide at least one usable business name for the OSHA lookup.');
  const priority = options.priority ?? true, key = `${names.map((entry) => entry.slice(0, 80)).sort().join('|')}|${state?.toUpperCase() ?? ''}`;

  const nameConditions = names.map((entry) => ({ field: 'estab_name', operator: 'like', value: `%${entry.slice(0, 80)}%` }));
  const conditions: unknown[] = [nameConditions.length === 1 ? nameConditions[0] : { or: nameConditions }];
  if (state) conditions.push({ field: 'site_state', operator: 'eq', value: state.toUpperCase() });

  const cached = inspectionCache.get(key);
  let rows = cached && cached.at > Date.now() - OSHA_CACHE_MS ? cached.rows : undefined;
  if (!rows) {
    if (oshaCoolingDown()) throw new Error(queuedMessage());
    if (!priority) {
      if (Date.now() - dolLastBackground < DOL_BACKGROUND_GAP_MS) {
        throw new Error('OSHA check queued: background lookups are paced to stay within Department of Labor limits. It fills in automatically.');
      }
      dolLastBackground = Date.now();
    }
    rows = await dolQuery<Record<string, unknown>>('inspection', conditions.length > 1 ? { and: conditions } : conditions[0], 200, priority);
    inspectionCache.set(key, { rows, at: Date.now() });
    if (inspectionCache.size > 500) inspectionCache.delete(inspectionCache.keys().next().value ?? '');
  }
  const base: OshaInspectionRecord[] = rows.map((row) => ({
    activity_nr: String(row.activity_nr ?? ''),
    establishment: toText(row.estab_name) ?? (Array.isArray(name) ? name[0] ?? '' : name),
    city: toText(row.site_city),
    state: toText(row.site_state),
    street: toText(row.site_address),
    zip: toText(row.site_zip),
    open_date: toText(row.open_date),
    case_status: toText(row.close_case_date) ? 'Closed' : 'Open',
    inspection_type: toText(row.insp_type),
    violations_serious: 0, violations_willful: 0, violations_repeat: 0, violations_other: 0, total_penalty: 0,
  }));
  const activities = [...new Set(base.filter((inspection) => inspection.activity_nr && (!options.match || options.match(inspection)))
    .map((inspection) => inspection.activity_nr))];
  const violations = activities.length
    ? await dolQuery<Record<string, unknown>>('violation', { field: 'activity_nr', operator: 'in', value: activities }, 500, priority)
    : [];
  const tally = new Map<string, { S: number; W: number; R: number; O: number; penalty: number }>();
  for (const violation of violations) {
    const activity = toText(violation.activity_nr);
    if (!activity || toText(violation.delete_flag) === 'X') continue;
    const entry = tally.get(activity) ?? { S: 0, W: 0, R: 0, O: 0, penalty: 0 };
    const type = toText(violation.viol_type);
    if (type === 'S' || type === 'W' || type === 'R' || type === 'O') entry[type] += 1;
    entry.penalty += toNumber(violation.current_penalty) ?? toNumber(violation.initial_penalty) ?? 0;
    tally.set(activity, entry);
  }

  const inspections = base.map((inspection): OshaInspectionRecord => {
    const counts = tally.get(inspection.activity_nr);
    return { ...inspection, violations_serious: counts?.S ?? 0, violations_willful: counts?.W ?? 0, violations_repeat: counts?.R ?? 0,
      violations_other: counts?.O ?? 0, total_penalty: counts?.penalty ?? 0 };
  });

  const totalPenalties = inspections.reduce((sum, inspection) => sum + (inspection.total_penalty ?? 0), 0);

  return {
    inspections: inspections.sort((a, b) => (b.open_date ?? '').localeCompare(a.open_date ?? '')),
    total_inspections: inspections.length,
    total_penalties: totalPenalties,
    fetched_at: new Date().toISOString(),
  };
}
/** Extracts a 2-letter state code from a stored lead address like "..., Tucson, AZ, 85713". */
export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/,\s*([A-Z]{2})\s*(?:,|\s|$)/);
  return match ? match[1] : null;
}
