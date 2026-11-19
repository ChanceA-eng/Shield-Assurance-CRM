import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RESEARCH_INDUSTRIES, RESEARCH_NAICS, type BusinessSearchFilters, type GooglePlace, type GooglePlacesResult, type GoogleSearchCoverage } from '@crm/shared';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';
import { radiusTerritory, type Territory } from './business-research-sources';
import { milesBetween, radiusCenter } from './research-geography';
import { googleAddress } from './google-match';

// Google Maps Platform terms prohibit storing Places content (names, addresses, phones) beyond place IDs,
// so results are returned live to the browser and never written to the CRM database.
const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber', 'places.websiteUri', 'places.location',
  'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.rating', 'places.userRatingCount', 'places.businessStatus', 'nextPageToken'].join(',');
const DEFAULT_CAP = 1000;

export function googlePlacesKey(): string | null { return process.env.GOOGLE_PLACES_API_KEY?.trim() || null; }
export function googlePlacesCap(): number {
  const value = Number(process.env.GOOGLE_PLACES_MONTHLY_CAP ?? DEFAULT_CAP);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_CAP;
}

const monthKey = (): string => `google_places:${new Date().toISOString().slice(0, 7)}:`;
async function monthlyUsage(db: SupabaseClient): Promise<number> {
  const counted = await db.from('business_research_request_slots').select('name', { count: 'exact', head: true }).like('name', `${monthKey()}%`);
  if (counted.error) throw databaseError(counted.error);
  if (counted.count === null) throw new WorkspaceError('Google Maps usage could not be verified.', 503);
  return counted.count;
}

/** Records one billable request; refuses (and releases the reservation) when the monthly cap would be exceeded. */
async function reserveRequest(db: SupabaseClient, cap: number): Promise<number> {
  const name = `${monthKey()}${randomUUID()}`;
  const saved = await db.from('business_research_request_slots').insert({ name, requested_at: new Date().toISOString() });
  if (saved.error) throw databaseError(saved.error);
  const used = await monthlyUsage(db);
  if (used > cap) {
    await db.from('business_research_request_slots').delete().eq('name', name);
    throw new WorkspaceError(`The monthly Google Maps search limit (${cap}) has been reached. The agency owner can raise GOOGLE_PLACES_MONTHLY_CAP.`, 429);
  }
  return used;
}

function place(value: unknown): GooglePlace | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const text = (item: unknown): string | null => typeof item === 'string' && item.trim() ? item.trim() : null;
  const name = isRecord(value.displayName) ? text(value.displayName.text) : null;
  if (!name) return null;
  const website = text(value.websiteUri);
  return {
    id: value.id, name, address: text(value.formattedAddress), phone: text(value.nationalPhoneNumber),
    website: website && /^https?:\/\//i.test(website) ? website : null,
    maps_url: text(value.googleMapsUri)?.startsWith('https://') ? text(value.googleMapsUri) : null,
    category: isRecord(value.primaryTypeDisplayName) ? text(value.primaryTypeDisplayName.text) : null,
    rating: typeof value.rating === 'number' ? value.rating : null,
    rating_count: typeof value.userRatingCount === 'number' ? value.userRatingCount : null,
    status: text(value.businessStatus),
    ...coordinates(isRecord(value.location) ? value.location.latitude : null, isRecord(value.location) ? value.location.longitude : null),
  };
}
function coordinates(latitude: unknown, longitude: unknown): { latitude: number | null; longitude: number | null } {
  return typeof latitude === 'number' && typeof longitude === 'number' && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : { latitude: null, longitude: null };
}

/** Validates a Google listing the browser received from search, so the OIP can research it without a second billable lookup. */
export function googlePlaceInput(value: unknown): GooglePlace {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\w-]{10,300}$/.test(value.id)) throw new WorkspaceError('Choose a Google Maps business.', 400);
  const text = (key: string, max: number): string | null => {
    const item = value[key];
    if (item === null || item === undefined || item === '') return null;
    if (typeof item !== 'string' || item.length > max) throw new WorkspaceError('Google Maps business details are invalid.', 400);
    return item.trim() || null;
  };
  const number = (key: string): number | null => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : null;
  const name = text('name', 300);
  if (!name) throw new WorkspaceError('Google Maps business details are invalid.', 400);
  const website = text('website', 2000), maps = text('maps_url', 2000);
  return { id: value.id, name, address: text('address', 500), phone: text('phone', 40),
    website: website && /^https?:\/\//i.test(website) ? website : null, maps_url: maps?.startsWith('https://') ? maps : null,
    category: text('category', 200), rating: number('rating'), rating_count: number('rating_count'), status: text('status', 60),
    ...coordinates(value.latitude, value.longitude) };
}

export interface GoogleQuery { textQuery: string; rectangle: Territory | null; page_token: string }
export async function searchGooglePlaces(db: SupabaseClient, query: GoogleQuery): Promise<GooglePlacesResult> {
  const key = googlePlacesKey();
  if (!key) return { configured: false, message: 'Google Maps matching needs GOOGLE_PLACES_API_KEY in the web server environment.' };
  const cap = googlePlacesCap(), used = await reserveRequest(db, cap);
  const body: Record<string, unknown> = { textQuery: query.textQuery, pageSize: 20, regionCode: 'US' };
  if (query.page_token) body.pageToken = query.page_token;
  if (query.rectangle) {
    const { south, west, north, east } = query.rectangle;
    body.locationRestriction = { rectangle: { low: { latitude: south, longitude: west }, high: { latitude: north, longitude: east } } };
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string' ? data.error.message : `HTTP ${response.status}`;
    throw new WorkspaceError(`Google Maps search failed: ${message}`, 502);
  }
  if (!isRecord(data)) throw new WorkspaceError('Google Maps returned an unsupported response.', 502);
  const places = Array.isArray(data.places) ? data.places.map(place).filter((item): item is GooglePlace => item !== null) : [];
  return { configured: true, places, next_page_token: typeof data.nextPageToken === 'string' ? data.nextPageToken : null, used, cap };
}

const INDUSTRY_KEYWORDS: Record<string, string> = {
  trucking: 'trucking company', restaurant: 'restaurant', contractor: 'contractor', retail: 'store', automotive: 'auto repair shop',
  hospitality: 'hotel', nonprofit: 'nonprofit organization', manufacturing: 'manufacturer', professional: 'professional services',
  real_estate: 'real estate office', wholesale: 'wholesaler', personal_services: 'salon',
};
export function googleKeyword(filters: BusinessSearchFilters): string | null {
  if (filters.query.trim()) return filters.query.trim();
  if (filters.naics) return RESEARCH_NAICS.find((item) => item.code === filters.naics)?.title ?? null;
  if (filters.industry) return INDUSTRY_KEYWORDS[filters.industry] ?? RESEARCH_INDUSTRIES.find((item) => item.id === filters.industry)?.label ?? null;
  return filters.city || filters.zip || filters.map_bounds ? 'businesses' : null;
}

/** Runs the Google Maps side of a Lead Finder search from the same filters, so the OIP can merge it with public records. */
export async function googleForFilters(db: SupabaseClient, filters: BusinessSearchFilters, pageToken: string): Promise<GoogleSearchCoverage> {
  const empty = (state: GoogleSearchCoverage['state'], message: string): GoogleSearchCoverage => ({ state, message, places: [], next_page_token: null });
  if (!googlePlacesKey()) return empty('unavailable', 'Google Maps matching needs GOOGLE_PLACES_API_KEY in the web server environment.');
  if (filters.contact === 'email') return empty('not_applicable', 'Google Maps does not list business email addresses.');
  if (filters.benefits || filters.min_participants || filters.max_participants || filters.min_power_units || filters.max_power_units
    || filters.min_revenue || filters.max_revenue) return empty('not_applicable', 'Google Maps cannot apply filing-based filters; matched records still show Google details.');
  const keyword = googleKeyword(filters);
  if (!keyword || !filters.state && !filters.map_bounds) return empty('not_applicable', 'Choose a state or map area to include Google Maps listings.');
  const rectangle = radiusTerritory(filters), center = radiusCenter(filters);
  const where = [filters.city, [filters.state, filters.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  try {
    const result = await searchGooglePlaces(db, { textQuery: rectangle || !where ? keyword : `${keyword} in ${where}`, rectangle, page_token: pageToken });
    if (!result.configured) return empty('unavailable', result.message);
    const places = result.places.flatMap((item): GooglePlace[] => {
      const address = googleAddress(item.address);
      if (filters.state && address.state && address.state !== filters.state) return [];
      if (filters.zip && address.zip !== filters.zip) return [];
      if (filters.contact === 'phone' && !item.phone || filters.contact === 'website' && !item.website || filters.contact === 'any' && !item.phone && !item.website) return [];
      const distance = center && item.latitude !== null && item.longitude !== null
        ? milesBetween(center, { latitude: item.latitude, longitude: item.longitude }) : null;
      if (center && (distance === null || distance > center.radius_miles)) return [];
      return [{ ...item, distance_miles: distance === null ? null : Math.round(distance * 10) / 10 }];
    });
    return { state: 'complete', places, next_page_token: result.next_page_token,
      message: `Google Maps listings for "${keyword}", matched to public records by the OIP. Shown live, not saved (${result.used} of ${result.cap} monthly searches used).` };
  } catch (error) {
    return empty('unavailable', error instanceof Error ? error.message : 'Google Maps could not be reached.');
  }
}

