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

export interface FmcsaCandidate {
  dot_number: string;
  legal_name: string;
  city: string | null;
  state: string | null;
}

export interface FmcsaRecord {
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
    toText(carrier.phyZipcode),
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

export async function fmcsaSearchByName(name: string, state?: string | null): Promise<FmcsaCandidate[]> {
  const webKey = process.env.FMCSA_WEBKEY?.trim();
  if (!webKey) throw new Error('FMCSA_WEBKEY is not configured.');

  const query = encodeURIComponent(name.slice(0, 60));
  const response = await fetch(`${FMCSA_BASE}/carriers/name/${query}?webKey=${webKey}`, {
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`FMCSA search failed (${response.status}).`);

  const payload = (await response.json()) as { content?: Array<FmcsaCarrierPayload> };
  const items = Array.isArray(payload.content) ? payload.content : [];

  const candidates = items
    .map((item) => item.carrier)
    .filter((carrier): carrier is Record<string, unknown> => Boolean(carrier))
    .map((carrier) => ({
      dot_number: String(carrier.dotNumber ?? ''),
      legal_name: toText(carrier.legalName) ?? 'Unknown',
      city: toText(carrier.phyCity),
      state: toText(carrier.phyState),
    }))
    .filter((candidate) => candidate.dot_number);

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

  const response = await fetch(`${FMCSA_BASE}/carriers/${encodeURIComponent(dotNumber)}?webKey=${webKey}`, {
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

async function dolQuery<T>(dataset: string, filterObject: unknown, limit: number): Promise<T[]> {
  const apiKey = process.env.DOL_API_KEY?.trim();
  if (!apiKey) throw new Error('DOL_API_KEY is not configured.');

  const params = new URLSearchParams({
    limit: String(limit),
    filter_object: JSON.stringify(filterObject),
  });
  const response = await fetch(`${DOL_BASE}/${dataset}/json?${params.toString()}`, {
    headers: { 'X-API-KEY': apiKey },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`OSHA data request failed (${response.status}).`);

  const payload = (await response.json()) as { data?: T[] } | T[];
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function oshaInspectionsByName(name: string, state?: string | null): Promise<OshaRecord> {
  // estab_name matching: uppercase prefix match catches most legal-name variants.
  const needle = name.toUpperCase().replace(/[^A-Z0-9 &]/g, '').slice(0, 40);

  const conditions: unknown[] = [{ field: 'estab_name', operator: 'like', value: `${needle}%` }];
  if (state) conditions.push({ field: 'site_state', operator: 'eq', value: state.toUpperCase() });

  const rows = await dolQuery<Record<string, unknown>>(
    'osha_inspection',
    conditions.length > 1 ? { and: conditions } : conditions[0],
    25,
  );

  const inspections: OshaInspectionRecord[] = rows.map((row) => ({
    activity_nr: String(row.activity_nr ?? ''),
    establishment: toText(row.estab_name) ?? name,
    city: toText(row.site_city),
    state: toText(row.site_state),
    open_date: toText(row.open_date),
    case_status: toText(row.case_mod_date) ? toText(row.close_case_date) ? 'Closed' : 'Open' : null,
    inspection_type: toText(row.insp_type),
    violations_serious: toNumber(row.nr_serious ?? row.violation_type_s),
    violations_willful: toNumber(row.nr_willful ?? row.violation_type_w),
    violations_repeat: toNumber(row.nr_repeat ?? row.violation_type_r),
    violations_other: toNumber(row.nr_other ?? row.violation_type_o),
    total_penalty: toNumber(row.total_current_penalty ?? row.total_penalty),
  }));

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
