import { parse } from 'csv-parse/sync';
import type { BusinessObservation, BusinessSearchFilters, ResearchCoverage, ResearchSource } from '@crm/shared';
import { isRecord } from './workspace-validation';
import { researchIndustry } from './business-research';
import { researchNaicsCategory, validEvidenceDate } from '@crm/shared';
import { EMPTY_BUSINESS_SEARCH } from '@crm/shared';
import { radiusCities, researchPlace } from './research-geography';

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => (typeof value === 'string' && value.trim() !== '' || typeof value === 'number') && Number.isFinite(Number(value)) ? Number(value) : null;
const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const ua = 'Shield-Assurance-CRM/1.0 (+https://shield-assurance-crm.vercel.app)';
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export async function researchSourceText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, { ...init, headers: { 'User-Agent': ua, ...init?.headers }, signal: AbortSignal.timeout(25000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('Public source returned no response body.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, result = '';
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) throw new Error('Source partition exceeds the interactive research budget. An indexed partition is required.');
      result += decoder.decode(item.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
function observation(source: ResearchSource, record: string, url: string, name: string): BusinessObservation {
  return { source, record_id: record, url, fetched_at: new Date().toISOString(), source_as_of: null, values: {
    name, street: null, city: null, state: null, zip: null, phone: null, email: null, website: null,
    latitude: null, longitude: null, industry: null, naics: null, classification: 'unknown',
    dot: null, ein: null, power_units: null, drivers: null, registration_reported_on: null, filing_year: null, assets: null, revenue: null,
  } };
}
export function sourceApplicability(filters: BusinessSearchFilters): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const industry = researchIndustry(filters);
  const trucking = industry?.id === 'trucking';
  const plansOnly = Boolean(filters.benefits || filters.min_participants || filters.max_participants);
  const generic = !filters.industry && !filters.naics && !filters.min_power_units && !filters.max_power_units && !filters.min_revenue && !filters.max_revenue;
  if (!plansOnly && !filters.map_bounds && filters.contact !== 'website' && (trucking || filters.query && !filters.industry && !filters.naics)) sources.push('fmcsa_census');
  if (!plansOnly && (industry?.osm || generic)) sources.push('osm');
  if (!plansOnly && !filters.map_bounds && !filters.contact && filters.state && (filters.industry === 'nonprofit' || filters.query && !filters.industry && !filters.naics)) sources.push('irs');
  if (!filters.map_bounds && !filters.min_power_units && !filters.max_power_units && !filters.min_revenue && !filters.max_revenue
    && ['', 'phone', 'any'].includes(filters.contact) && filters.state && !trucking && filters.industry !== 'nonprofit'
    && (filters.naics || filters.industry || filters.query)) sources.push('dol_5500');
  return sources;
}
export async function searchCensus(filters: BusinessSearchFilters, page: number, dot?: string): Promise<BusinessObservation[]> {
  const where: string[] = [];
  if (dot) {
    if (!/^\d+$/.test(dot)) throw new Error('Invalid public DOT identity.');
    where.push(`dot_number=${quote(dot)}`);
  }
  if (filters.query) where.push(`(upper(legal_name) like ${quote(`%${filters.query.toUpperCase().replace(/[%_]/g, '')}%`)} or upper(dba_name) like ${quote(`%${filters.query.toUpperCase().replace(/[%_]/g, '')}%`)})`);
  if (filters.state) where.push(`phy_state=${quote(filters.state)}`);
  const nearby = dot ? null : radiusCities(filters);
  if (nearby) where.push(nearby.length ? `upper(phy_city) in (${nearby.map(quote).join(',')})` : '1=0');
  else if (filters.city) where.push(`upper(phy_city)=${quote(filters.city.toUpperCase())}`);
  if (filters.zip) where.push(`phy_zip like ${quote(`${filters.zip}%`)}`);
  if (filters.min_power_units) where.push(`power_units>=${Number(filters.min_power_units)}`);
  if (filters.max_power_units) where.push(`power_units<=${Number(filters.max_power_units)}`);
  if (filters.contact === 'phone') where.push("phone is not null and phone<>''");
  if (filters.contact === 'email') where.push("email_address is not null and email_address<>''");
  if (filters.contact === 'any') where.push("(phone is not null and phone<>'' or email_address is not null and email_address<>'')");
  const params = new URLSearchParams({ '$select': 'dot_number,legal_name,dba_name,phy_street,phy_city,phy_state,phy_zip,phone,email_address,power_units,total_drivers,mcs150_date',
    '$limit': '25', '$offset': String(page * 25), '$order': 'dot_number' });
  if (where.length) params.set('$where', where.join(' and '));
  const payload: unknown = JSON.parse(await researchSourceText(`https://data.transportation.gov/resource/az4n-8mr2.json?${params}`));
  if (!Array.isArray(payload) || payload.length > 25 || !payload.every((item) => isRecord(item) && /^\d+$/.test(String(item.dot_number)) && text(item.legal_name))) {
    throw new Error('FMCSA Census response does not match the supported schema.');
  }
  return payload.map((item) => {
    const row = observation('fmcsa_census', String(item.dot_number), `https://data.transportation.gov/d/az4n-8mr2`, item.legal_name);
    row.values = { ...row.values, dot: String(item.dot_number), street: text(item.phy_street), city: text(item.phy_city),
      state: text(item.phy_state), zip: text(item.phy_zip), phone: text(item.phone), email: text(item.email_address),
      industry: 'DOT-registered business', classification: 'reported', power_units: number(item.power_units), drivers: number(item.total_drivers) };
    const date = text(item.mcs150_date);
    const day = date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date?.slice(0, 10);
    row.values.registration_reported_on = validEvidenceDate(day) ? day : null;
    return row;
  }).filter((row) => (!filters.state || row.values.state === filters.state)
    && (nearby ? nearby.includes(row.values.city?.toUpperCase() ?? '') : !filters.city || row.values.city?.toLowerCase() === filters.city.toLowerCase())
    && (!filters.zip || row.values.zip?.slice(0, 5) === filters.zip));
}
export interface Territory { south: number; west: number; north: number; east: number }
export function radiusTerritory(filters: BusinessSearchFilters): Territory | null {
  if (filters.map_bounds) {
    const [south, west, north, east] = filters.map_bounds.split(',').map(Number);
    return { south, west, north, east };
  }
  if (!filters.radius_miles || !filters.place_id) return null;
  const place = researchPlace(filters.state, filters.place_id), km = Number(filters.radius_miles) * 1.609344;
  const angle = km / 6371, dy = angle * 180 / Math.PI, dx = Math.asin(Math.sin(angle) / Math.cos(place.latitude * Math.PI / 180)) * 180 / Math.PI;
  return { south: place.latitude - dy, north: place.latitude + dy, west: place.longitude - dx, east: place.longitude + dx };
}
export async function resolveTerritory(filters: BusinessSearchFilters): Promise<Territory> {
  if (!filters.city || !filters.state) throw new Error('Choose a city and state for open-map business discovery.');
  // Only an explicit territory search reaches Nominatim, never autocomplete or CRM-address refresh.
  const params = new URLSearchParams({ city: filters.city, state: filters.state, country: 'USA', countrycodes: 'us', format: 'jsonv2', addressdetails: '1', limit: '1' });
  const endpoint = process.env.CRM_RESEARCH_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
  const payload: unknown = JSON.parse(await researchSourceText(`${endpoint}?${params}`));
  if (!Array.isArray(payload) || !isRecord(payload[0]) || !Array.isArray(payload[0].boundingbox) || payload[0].boundingbox.length !== 4
    || !isRecord(payload[0].address) || payload[0].address.country_code !== 'us' || payload[0].address['ISO3166-2-lvl4'] !== `US-${filters.state}`) {
    throw new Error('The requested territory could not be resolved. Check city and state.');
  }
  const [south, north, west, east] = payload[0].boundingbox.map(Number);
  if (![south, north, west, east].every(Number.isFinite) || south < -90 || north > 90 || west < -180 || east > 180
    || south >= north || west >= east || north - south > 2 || east - west > 2) {
    throw new Error('Choose a smaller city territory for open-map discovery.');
  }
  return { south, north, west, east };
}
export function mappedBusinessObservation(id: string, tags: Record<string, unknown>, latitude: number | null, longitude: number | null,
  edited: string | null, filters: BusinessSearchFilters = EMPTY_BUSINESS_SEARCH): BusinessObservation {
  const name = text(tags.name);
  if (!name || name.length > 300 || !/^(node|way|relation)\/\d+$/.test(id)) throw new Error('Open-map business identity is invalid.');
  if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)
    || longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) throw new Error('Open-map business coordinates are outside valid ranges.');
  const industry = researchIndustry(filters), category = filters.naics ? researchNaicsCategory(filters.naics)?.osm : industry?.osm;
  const row = observation('osm', id, `https://www.openstreetmap.org/${id}`, name);
  row.source_as_of = validEvidenceDate(edited) ? edited : null;
  row.values = { ...row.values, street: [text(tags['addr:housenumber']), text(tags['addr:street'])].filter(Boolean).join(' ') || null,
    city: text(tags['addr:city']), state: text(tags['addr:state']), zip: text(tags['addr:postcode']),
    phone: text(tags['contact:phone']) ?? text(tags.phone), email: text(tags['contact:email']) ?? text(tags.email),
    website: text(tags['contact:website']) ?? text(tags.website), latitude, longitude,
    industry: industry && category && new RegExp(category[1]).test(String(tags[category[0]] ?? '')) ? industry.label
      : text(tags.shop) ?? text(tags.craft) ?? text(tags.office) ?? text(tags.amenity) ?? text(tags.tourism) ?? text(tags.man_made),
    classification: 'mapped',
    map_tags: Object.fromEntries(['shop', 'craft', 'office', 'amenity', 'tourism', 'man_made']
      .flatMap((key) => text(tags[key]) ? [[key, String(tags[key]).trim()]] : [])),
  };
  return row;
}
export async function searchOsm(filters: BusinessSearchFilters, territory: Territory, page: number, recordId?: string): Promise<BusinessObservation[]> {
  const industry = researchIndustry(filters);
  if (page > 0) throw new Error('Open-map discovery is capped at 25 businesses per territory. Narrow the category or territory; additional pages are not exhaustive.');
  const category = filters.naics ? researchNaicsCategory(filters.naics)?.osm : industry?.osm;
  const escaped = filters.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = `${category ? `[${JSON.stringify(category[0])}~${JSON.stringify(category[1])}]` : '[~"^(shop|craft|office|amenity|tourism)$"~"."]'}${filters.query ? `["name"~${JSON.stringify(escaped)},i]` : ''}${filters.zip ? `["addr:postcode"~"^${filters.zip}"]` : ''}["name"]`;
  const box = `${territory.south},${territory.west},${territory.north},${territory.east}`;
  if (recordId && !/^(node|way|relation)\/\d+$/.test(recordId)) throw new Error('Invalid open-map business identity.');
  const center = filters.radius_miles && filters.place_id ? researchPlace(filters.state, filters.place_id) : null;
  const area = center ? `around:${Number(filters.radius_miles) * 1609.344},${center.latitude},${center.longitude}` : box;
  const contactTags = filters.contact === 'phone' ? '[~"^(contact:phone|phone)$"~"."]'
    : filters.contact === 'email' ? '[~"^(contact:email|email)$"~"."]'
      : filters.contact === 'website' ? '[~"^(contact:website|website)$"~"."]'
        : filters.contact === 'any' ? '[~"^(contact:phone|phone|contact:email|email|contact:website|website)$"~"."]' : '';
  const query = recordId ? `[out:json][timeout:20];${recordId.replace('/', '(')});out meta center;`
    : `[out:json][timeout:20];nwr${tags}${contactTags}(${area});out meta center 25;`;
  const payload: unknown = JSON.parse(await researchSourceText(process.env.CRM_RESEARCH_OVERPASS_URL ?? 'https://overpass.private.coffee/api/interpreter', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }).toString() }));
  if (!isRecord(payload) || !Array.isArray(payload.elements) || payload.remark || payload.elements.length > 25) throw new Error('Open-map research returned an incomplete or unsupported response.');
  return payload.elements.map((item: unknown) => {
    if (!isRecord(item) || !isRecord(item.tags) || !text(item.tags.name) || !['node', 'way', 'relation'].includes(String(item.type)) || !Number.isSafeInteger(item.id)) {
      throw new Error('Open-map business identity is invalid.');
    }
    const tags = item.tags, id = `${item.type}/${item.id}`;
    const edited = text(item.timestamp)?.slice(0, 10);
    const location = isRecord(item.center) ? item.center : item;
    const latitude = number(location.lat), longitude = number(location.lon);
    return mappedBusinessObservation(id, tags, latitude, longitude, edited ?? null, filters);
  }).filter((row: BusinessObservation) => !filters.zip || row.values.zip?.slice(0, 5) === filters.zip);
}
export async function searchIrs(filters: BusinessSearchFilters, page: number, ein?: string): Promise<BusinessObservation[]> {
  const body = await researchSourceText(`https://www.irs.gov/pub/irs-soi/eo_${filters.state.toLowerCase()}.csv`);
  const payload: unknown = parse(body, { columns: true, bom: true, skip_empty_lines: true });
  if (!Array.isArray(payload) || !payload.every((item) => isRecord(item) && typeof item.EIN === 'string' && typeof item.NAME === 'string')) throw new Error('IRS organization extract has an unsupported schema.');
  return payload.filter((item) => (!ein || item.EIN === ein) && (!filters.state || item.STATE === filters.state)
    && (!filters.query || item.NAME.toLowerCase().includes(filters.query.toLowerCase()))
    && (!filters.city || item.CITY?.toLowerCase() === filters.city.toLowerCase())
    && (!filters.zip || item.ZIP?.slice(0, 5) === filters.zip)
    && (!filters.min_revenue || number(item.REVENUE_AMT) !== null && Number(item.REVENUE_AMT) >= Number(filters.min_revenue))
    && (!filters.max_revenue || number(item.REVENUE_AMT) !== null && Number(item.REVENUE_AMT) <= Number(filters.max_revenue)))
    .slice(page * 25, (page + 1) * 25).map((item) => {
      const row = observation('irs', item.EIN, 'https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf', item.NAME);
      row.values = { ...row.values, ein: item.EIN, street: text(item.STREET), city: text(item.CITY), state: text(item.STATE),
        zip: text(item.ZIP), industry: 'Tax-exempt organization', classification: 'reported',
        filing_year: text(item.TAX_PERIOD), assets: number(item.ASSET_AMT), revenue: number(item.REVENUE_AMT) };
      return row;
    });
}
export async function refreshBusinessObservation(previous: BusinessObservation): Promise<BusinessObservation> {
  const filters: BusinessSearchFilters = { ...EMPTY_BUSINESS_SEARCH };
  let rows: BusinessObservation[];
  if (previous.source === 'fmcsa_census') rows = await searchCensus(filters, 0, previous.record_id);
  else if (previous.source === 'irs') {
    if (!previous.values.state || !/^[A-Z]{2}$/.test(previous.values.state)) throw new Error('IRS refresh requires the source state partition.');
    filters.state = previous.values.state;
    rows = await searchIrs(filters, 0, previous.record_id);
  } else if (previous.source === 'osm') rows = await searchOsm(filters, { south: 0, west: 0, north: 0, east: 0 }, 0, previous.record_id);
  else throw new Error('Form 5500 refresh requires its retained directory index.');
  const observation = rows.find((item) => item.source === previous.source && item.record_id === previous.record_id);
  if (!observation) throw new Error('The previous public business identity was not returned. Historical evidence was retained; no replacement was guessed.');
  return observation;
}
export const coverage = (source: ResearchSource, state: ResearchCoverage['state'], message: string): ResearchCoverage => ({ source, state, message });
