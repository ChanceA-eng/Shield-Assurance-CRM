import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RESEARCH_TAXONOMY_VERSION, EMPTY_OPPORTUNITY_PROFILE, EMPTY_DOSSIER_FINDINGS, type CarrierAppetiteDocument, type BusinessObservation, type BusinessResearchProfile, type BusinessSearchFilters, type BusinessSearchResult,
  type GooglePlace, type GoogleSearchCoverage, type ResearchBusiness, type ResearchCoverage, type ResearchSource } from '@crm/shared';
import { activeAgencyMember } from './agency-membership';
import { businessSearchFilters, researchIdentity, researchMatchingFacts } from './business-research';
import { evaluateOpportunity } from './opportunity-matching';
import { coverage, radiusTerritory, resolveTerritory, searchCensus, sourceApplicability, type Territory } from './business-research-sources';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { searchDirectory, searchOsmDirectory } from './business-research-index';
import { fmcsaConfigured, oshaConfigured } from './enrichment';
import { googleForFilters } from './google-places';
import { googleAddress, googleMatchesRecord } from './google-match';
import { milesBetween, radiusCenter } from './research-geography';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export async function researchReadiness(db: SupabaseClient): Promise<NonNullable<BusinessResearchProfile['readiness']>> {
  const documents = await db.from('carrier_appetite_documents').select('id', { count: 'exact', head: true }).eq('state', 'active');
  if (documents.error) throw databaseError(documents.error);
  if (documents.count === null) throw new WorkspaceError('Carrier appetite readiness could not be loaded.', 503);
  return { active_carrier_documents: documents.count, osha_configured: oshaConfigured(), fmcsa_configured: fmcsaConfigured() };
}

export async function researchProfile(db: SupabaseClient, actor: string, business: string): Promise<BusinessResearchProfile> {
  const result = await db.rpc('get_business_research', { p_actor: actor, p_business: business }).single<BusinessResearchProfile>();
  if (result.error) throw databaseError(result.error);
  if (!result.data?.business) throw new WorkspaceError('Business research could not be loaded.', 503);
  return result.data;
}

export async function refreshResearchMarketFit(db: SupabaseClient, profile: BusinessResearchProfile): Promise<void> {
  if (!profile.business || !profile.job) return;
  const carriers = await db.from('carrier_appetite_documents').select('id,revision,state,values,approved_by,approved_at')
    .eq('state', 'active').limit(1001).returns<CarrierAppetiteDocument[]>();
  if (carriers.error) throw databaseError(carriers.error);
  if (carriers.data.length > 1000) throw new WorkspaceError('Narrow the active carrier guide library before matching.', 503);
  const { facts, current } = researchMatchingFacts(profile.business.observations);
  const market = evaluateOpportunity({ ...EMPTY_OPPORTUNITY_PROFILE, facts }, carriers.data, {
    scope_key: `business:${profile.business.id}`, record_name: profile.business.name, version: 0,
    findings: { ...EMPTY_DOSSIER_FINDINGS }, confirmations: [], observations: [], observations_total: 0, history_total: 0, page: 0,
  }, new Date().toISOString().slice(0, 10), current);
  profile.job.result = { insights: [], coverage: [], context: [], ...profile.job.result, market_fit: market };
}

export async function researchRequestSlot(db: SupabaseClient, name: string, seconds: number): Promise<void> {
  const result = await db.rpc('research_request_slot', { p_name: name, p_seconds: seconds });
  if (result.error) throw databaseError(result.error);
  if (result.data !== true) throw new WorkspaceError('This public source is cooling down. Retry shortly.', 429);
}

async function territory(db: SupabaseClient, filters: BusinessSearchFilters): Promise<Territory> {
  const radius = radiusTerritory(filters);
  if (radius) return radius;
  const key = hash(`${filters.city.toLowerCase()}:${filters.state}`);
  const cached = await db.from('business_research_territories').select('bounds').eq('query_hash', key)
    .gt('fetched_at', new Date(Date.now() - 30 * 86400000).toISOString()).maybeSingle<{ bounds: Territory }>();
  if (cached.error) throw databaseError(cached.error);
  if (cached.data) return cached.data.bounds;
  await researchRequestSlot(db, 'nominatim', 2);
  const bounds = await resolveTerritory(filters);
  const saved = await db.from('business_research_territories').upsert({ query_hash: key, bounds, fetched_at: new Date().toISOString() });
  if (saved.error) throw databaseError(saved.error);
  return bounds;
}

interface SearchWindow { id: string; business_ids: string[]; coverage: ResearchCoverage[]; has_more: boolean }
export interface UnifiedSearchOptions { google_page_token?: string; skip_records?: boolean; skip_google?: boolean }
const businessPoint = (business: ResearchBusiness): { latitude: number; longitude: number } | null => {
  const values = business.observations.find((item) => item.values.latitude !== null && item.values.longitude !== null)?.values;
  return values?.latitude !== null && values?.latitude !== undefined && values.longitude !== null ? { latitude: values.latitude, longitude: values.longitude } : null;
};

/** One Lead Finder search: public records and Google Maps run together and the OIP merges matching listings into each record. */
export async function searchBusinesses(db: SupabaseClient, actor: string, input: unknown, page: number, requestId: string = randomUUID(),
  options: UnifiedSearchOptions = {}): Promise<BusinessSearchResult> {
  await activeAgencyMember(db, actor);
  if (!Number.isInteger(page) || page < 0 || page > 1000) throw new WorkspaceError('Choose a valid search page.', 400);
  const filters = businessSearchFilters(input);
  const [records, google] = await Promise.all([
    options.skip_records ? Promise.resolve<BusinessSearchResult>({ run_id: requestId, businesses: [], coverage: [], next_page: null })
      : searchRecords(db, actor, filters, page, requestId).catch((error: unknown) => error instanceof Error ? error : new Error('Business search failed.')),
    options.skip_google ? Promise.resolve<GoogleSearchCoverage>({ state: 'complete', message: 'No more Google Maps listings for this search.', places: [], next_page_token: null })
      : googleForFilters(db, filters, options.google_page_token ?? ''),
  ]);
  if (records instanceof Error && !google.places.length) throw records;
  const result: BusinessSearchResult = records instanceof Error ? { run_id: requestId, businesses: [], next_page: null,
    coverage: [coverage('osm', 'unavailable', records.message)] } : records;
  const center = radiusCenter(filters);
  let unmatched = [...google.places];
  const merged = result.businesses.map((business): ResearchBusiness => {
    const index = unmatched.findIndex((place) => googleMatchesRecord(place, business.observations));
    return { ...business, google: index >= 0 ? unmatched.splice(index, 1)[0] : null };
  });
  // Listings without a record on this page are checked against the whole state index, so Google contacts land on the matching OIP record.
  const linked = unmatched.length ? await withTimeout(linkGooglePlaces(db, actor, unmatched, filters), LINK_TIMEOUT_MS).catch((error: unknown) => {
    console.error('[business-research:google-link]', error);
    return [];
  }) : [];
  for (const business of linked) {
    unmatched = unmatched.filter((place) => place.id !== business.google?.id);
    const existing = merged.find((item) => item.id === business.id);
    if (!existing) merged.push(business);
    else if (!existing.google) existing.google = business.google;
  }
  const businesses = merged.map((business): ResearchBusiness => {
    const match = business.google ?? null;
    const point = businessPoint(business) ?? (match && match.latitude !== null && match.longitude !== null ? { latitude: match.latitude, longitude: match.longitude } : null);
    return { ...business, distance_miles: center && point ? Math.round(milesBetween(center, point) * 10) / 10 : null };
  });
  if (center) businesses.sort((a, b) => (a.distance_miles ?? Infinity) - (b.distance_miles ?? Infinity));
  return { ...result, businesses, google: { ...google, places: unmatched }, center: center ?? null };
}

const LINK_TIMEOUT_MS = 8000;
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Google listing match timed out.')), ms); });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

const GENERIC_NAME_WORDS = new Set(['the', 'and', 'inc', 'llc', 'corp', 'company', 'group', 'services', 'service', 'solutions', 'enterprises', 'plumbing',
  'heating', 'cooling', 'air', 'conditioning', 'hvac', 'mechanical', 'contractor', 'contractors', 'construction', 'electric', 'electrical', 'roofing',
  'repair', 'home', 'pros', 'professional', 'american', 'national', 'quality', 'best', 'all']);
/** The most distinctive word of a business name, used to pull candidate records from the index cheaply. */
export function nameNeedle(name: string): string | null {
  const words = name.split(/[\s,&/.()-]+/).map((word) => word.replace(/[^A-Za-z0-9']/g, '')).filter((word) => word.length >= 3);
  return words.find((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word.toLowerCase()))
    ?? [...words].sort((a, b) => b.length - a.length)[0] ?? null;
}

interface IndexPartition { provider: string; state: string; active_version: string | number | null; building_version: string | number | null }
/** Finds indexed public records (OpenStreetMap, Form 5500, IRS) that are the same establishment as each Google listing, retains them as OIP businesses and returns them with the listing attached. */
export async function linkGooglePlaces(db: SupabaseClient, actor: string, places: readonly GooglePlace[], filters: BusinessSearchFilters): Promise<ResearchBusiness[]> {
  const candidates = places.flatMap((place) => {
    const state = googleAddress(place.address).state ?? filters.state, needle = nameNeedle(place.name);
    return state && needle ? [{ place, state, needle }] : [];
  });
  if (!candidates.length) return [];
  const [sources, partitions] = await Promise.all([
    db.from('business_research_sources').select('provider,enabled,retained_rights'),
    db.from('business_research_partitions').select('provider,state,active_version,building_version')
      .in('state', [...new Set(candidates.map((item) => item.state))]).in('provider', ['osm', 'irs', 'dol_5500']).returns<IndexPartition[]>(),
  ]);
  if (sources.error) throw databaseError(sources.error);
  if (partitions.error) throw databaseError(partitions.error);
  const allowed = new Set(sources.data.filter((item) => item.enabled && item.retained_rights).map((item) => String(item.provider)));
  const versions = new Map(partitions.data.flatMap((item) => {
    const version = item.active_version ?? item.building_version;
    return version !== null && allowed.has(item.provider) ? [[`${item.provider}:${item.state}`, String(version)] as const] : [];
  }));
  const found = await Promise.all(candidates.map(async ({ place, state, needle }) => {
    const providers = [...allowed].filter((provider) => versions.has(`${provider}:${state}`));
    if (!providers.length) return [];
    const rows = await db.from('business_research_directory_records').select('provider,version,observation').eq('state', state).in('provider', providers)
      .ilike('name', `%${needle.replace(/[\\%_]/g, '\\$&')}%`).limit(60)
      .returns<Array<{ provider: string; version: string | number; observation: BusinessObservation }>>();
    if (rows.error) throw databaseError(rows.error);
    return rows.data.filter((row) => versions.get(`${row.provider}:${state}`) === String(row.version) && googleMatchesRecord(place, [row.observation]))
      .map((row) => row.observation);
  }));
  const items = found.flat().slice(0, 75).map((observation) => ({ identity: researchIdentity(observation), observation }));
  if (!items.length) return [];
  const saved = await db.rpc('retain_research_search', { p_actor: actor, p_run: randomUUID(),
    p_hash: hash(`google-link:${places.map((place) => place.id).sort().join(',')}`), p_filters: filters, p_page: 0,
    p_items: items, p_coverage: [], p_more: false }).single<SearchWindow>();
  if (saved.error) throw databaseError(saved.error);
  if (!saved.data) return [];
  const profiles = await Promise.all(saved.data.business_ids.map((id) => researchProfile(db, actor, id)));
  const open = [...places];
  return profiles.flatMap((profile): ResearchBusiness[] => {
    const business = profile.business;
    if (!business) return [];
    const index = open.findIndex((place) => googleMatchesRecord(place, business.observations));
    return index >= 0 ? [{ ...business, linked_record: profile.linked_record, google: open.splice(index, 1)[0] }] : [];
  });
}

async function searchRecords(db: SupabaseClient, actor: string, filters: BusinessSearchFilters, page: number, requestId: string): Promise<BusinessSearchResult> {
  const window = Math.floor(page / 4), offset = page % 4 * 25;
  const queryHash = hash(JSON.stringify({ version: RESEARCH_TAXONOMY_VERSION, filters }));
  const [settings, sources, cached] = await Promise.all([
    db.from('business_research_settings').select('enabled').eq('id', 1).single(),
    db.from('business_research_sources').select('provider,enabled,retained_rights'),
    db.from('business_research_runs').select('id,business_ids,coverage,has_more').eq('query_hash', queryHash).eq('page', window)
      .gt('created_at', new Date(Date.now() - 15 * 60000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle<SearchWindow>(),
  ]);
  if (settings.error) throw databaseError(settings.error);
  if (sources.error) throw databaseError(sources.error);
  if (cached.error) throw databaseError(cached.error);
  if (!settings.data.enabled) throw new WorkspaceError('Business discovery is paused. The agency owner can enable it in Settings → Intelligence.', 503);
  let retained = cached.data?.coverage.some((item) => item.state === 'unavailable')
    || cached.data && !cached.data.business_ids.length ? null : cached.data;
  if (!retained) {
    const applicable = sourceApplicability(filters);
    if (!applicable.length) throw new WorkspaceError(filters.naics
      ? 'This official NAICS code has no available business-discovery connector yet. Broaden the industry or choose another code.'
      : 'No available source supports this filter combination. Remove a contact/radius filter or choose another industry.', 400);
    const outcomes = await Promise.all(applicable.map(async (source): Promise<{ rows: BusinessObservation[]; status: ResearchCoverage }> => {
      const config = sources.data.find((item) => item.provider === source);
      if (!config?.enabled || !config.retained_rights) return { rows: [], status: coverage(source, 'unavailable', 'Source paused by the agency owner.') };
      try {
        if (source === 'irs' || source === 'dol_5500' || source === 'osm') {
          const indexed = source === 'osm' ? await searchOsmDirectory(db, actor, filters, window, () => territory(db, filters))
            : await searchDirectory(db, actor, source, filters, window);
          return { rows: indexed.rows, status: coverage(source, 'partial', indexed.message) };
        }
        const slot = await db.rpc('research_source_slot', { p_provider: source });
        if (slot.error) throw databaseError(slot.error);
        if (slot.data !== true) throw new WorkspaceError('Public-source request budget is busy. Retry shortly.', 429);
        let rows: BusinessObservation[];
        if (source === 'fmcsa_census') rows = await searchCensus(filters, window);
        else throw new WorkspaceError('No live connector supports this source.', 503);
        return { rows, status: coverage(source, 'partial', 'FMCSA registration records. DOT registration is not proof of trucking industry, current insurance or verified contacts.') };
      } catch (error) {
        console.error(`[business-research:${source}]`, error);
        return { rows: [], status: coverage(source, 'unavailable', error instanceof Error ? error.message : 'Public source could not be reached.') };
      }
    }));
    const unavailable = outcomes.every((item) => item.status.state === 'unavailable');
    if (unavailable) throw new WorkspaceError(outcomes.map((item) => `${item.status.source}: ${item.status.message}`).join(' '), 503);
    const statuses = outcomes.map((item) => item.status);
    for (const source of ['fmcsa_census', 'osm', 'irs', 'dol_5500'] as ResearchSource[]) {
      if (!applicable.includes(source)) statuses.push(coverage(source, 'not_applicable', 'Not applicable to these filters.'));
    }
    const saved = await db.rpc('retain_research_search', {
      p_actor: actor, p_run: requestId, p_hash: queryHash, p_filters: filters, p_page: window,
      p_items: outcomes.flatMap((item) => item.rows.map((observation) => ({ identity: researchIdentity(observation), observation }))),
      p_coverage: statuses, p_more: outcomes.some((item) => item.rows.length === 25),
    }).single<SearchWindow>();
    if (saved.error) throw databaseError(saved.error);
    if (!saved.data) throw new WorkspaceError('Search results could not be retained.', 503);
    retained = saved.data;
  }
  const permitted = new Set(sources.data.filter((item) => item.retained_rights).map((item) => item.provider));
  const profiles = await Promise.all(retained.business_ids.slice(offset, offset + 25).map((id) => researchProfile(db, actor, id)));
  return { run_id: retained.id, businesses: profiles.flatMap((profile) => profile.business ? [{ ...profile.business, linked_record: profile.linked_record }] : []),
    coverage: retained.coverage.map((item) => permitted.has(item.source) ? item : coverage(item.source, 'unavailable', 'Retained-use permission was withdrawn.')),
    next_page: offset + 25 < retained.business_ids.length ? page + 1 : retained.has_more ? (window + 1) * 4 : null };
}
