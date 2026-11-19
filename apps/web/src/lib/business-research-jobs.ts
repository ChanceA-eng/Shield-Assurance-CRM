import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, type BusinessObservation,
  type CarrierAppetiteDocument, type ResearchJobResult } from '@crm/shared';
import { researchProfile, researchRequestSlot } from './business-research-server';
import { researchIdentity, researchInsights, researchMatchingFacts } from './business-research';
import { refreshBusinessObservation, researchSourceText } from './business-research-sources';
import { fmcsaConfigured, fmcsaGetCarrier, fmcsaSearchByName, oshaConfigured, oshaCoolingDown, oshaInspectionsByName,
  type FmcsaCandidate, type FmcsaRecord, type OshaInspectionRecord } from './enrichment';
import { evaluateOpportunity } from './opportunity-matching';
import { databaseError } from './workspace-api';
import { businessNameKey } from './google-match';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { findIrsFiling, refreshDirectoryObservation } from './business-research-index';
import { matchesIrsFinancials, readIrsFinancials } from './business-research-irs-filing';

type Job = { business_id: string; actor_id: string; lease: string };
/** Evidence the OIP can research: retained public records, or a live Google Maps listing that is never stored. */
export type ResearchEvidence = Pick<BusinessObservation, 'url' | 'values'> & { source: BusinessObservation['source'] | 'google' };
const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function namesAgree(a: string, b: string): boolean {
  const left = businessNameKey(a), right = businessNameKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  return short.length >= 6 && long.includes(short);
}
const streetKey = (value: string): string => normalized(value.split(/\b(?:suite|ste|unit|apt|apartment|floor|fl)\b|#/i)[0]
  .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|north|south|east|west|n|s|e|w)\b\.?/gi, ''));
function inspectionMatches(observations: ResearchEvidence[], inspection: OshaInspectionRecord): boolean {
  return observations.some(({ values }) => {
    if (!values.street || !values.state || !inspection.street || !inspection.state
      || !namesAgree(values.name, inspection.establishment)
      || /^\d+/.exec(values.street)?.[0] !== /^\d+/.exec(inspection.street)?.[0]
      || streetKey(values.street) !== streetKey(inspection.street)
      || values.state.toUpperCase() !== inspection.state.toUpperCase()) return false;
    if (values.zip && inspection.zip && values.zip.slice(0, 5) !== inspection.zip.slice(0, 5)) return false;
    return Boolean(values.zip && inspection.zip || values.city && inspection.city
      && normalized(values.city) === normalized(inspection.city));
  });
}
export function matchedWorkplaceInspections(observations: ResearchEvidence[], inspections: OshaInspectionRecord[]): OshaInspectionRecord[] {
  return inspections.filter((inspection) => inspectionMatches(observations, inspection));
}

export async function researchLocation(observations: ResearchEvidence[]): Promise<{ latitude: number; longitude: number; accuracy: string; url: string } | null> {
  const mapped = observations.find((item) => (item.source === 'osm' || item.source === 'google') && item.values.latitude !== null && item.values.longitude !== null);
  if (mapped?.values.latitude !== null && mapped?.values.latitude !== undefined && mapped.values.longitude !== null) {
    return { latitude: mapped.values.latitude, longitude: mapped.values.longitude, url: mapped.url,
      accuracy: mapped.source === 'google' ? 'Google Maps business location; not a certified parcel coordinate.' : 'OpenStreetMap feature location; not a certified parcel coordinate.' };
  }
  const address = observations.find((item) => item.values.street && item.values.city && item.values.state && item.values.zip);
  if (!address) return null;
  const v = address.values;
  if (!v.street || !v.city || !v.state || !v.zip) throw new Error('Public business address is incomplete.');
  const params = new URLSearchParams({ street: v.street, city: v.city, state: v.state, zip: v.zip, benchmark: 'Public_AR_Current', format: 'json' });
  const url = `https://geocoding.geo.census.gov/geocoder/locations/address?${params}`;
  const result: unknown = JSON.parse(await researchSourceText(url));
  if (!isRecord(result) || !isRecord(result.result) || !Array.isArray(result.result.addressMatches)) throw new Error('Census geocoder response is unsupported.');
  if (result.result.addressMatches.length !== 1) throw new Error('Business address has no unique Census coordinate. Location context was not assigned.');
  const match = result.result.addressMatches[0];
  if (!isRecord(match) || !isRecord(match.coordinates) || typeof match.coordinates.x !== 'number' || typeof match.coordinates.y !== 'number'
    || !Number.isFinite(match.coordinates.x) || !Number.isFinite(match.coordinates.y) || Math.abs(match.coordinates.x) > 180 || Math.abs(match.coordinates.y) > 90
    || typeof match.matchedAddress !== 'string' || normalized(match.matchedAddress.split(',')[0]) !== normalized(v.street)
    || !isRecord(match.addressComponents) || normalized(String(match.addressComponents.state ?? '')) !== normalized(v.state)
    || String(match.addressComponents.zip ?? '').slice(0, 5) !== v.zip.slice(0, 5)) throw new Error('Census location does not corroborate the business territory.');
  return { latitude: match.coordinates.y, longitude: match.coordinates.x, accuracy: 'Census address-range coordinate, not rooftop or parcel verification.', url };
}

async function enrich(db: SupabaseClient, observations: ResearchEvidence[], previous: ResearchJobResult | null = null,
  linked = false, priority = false): Promise<Pick<ResearchJobResult,
    'research_version' | 'coverage' | 'context' | 'financials' | 'osha_candidates' | 'fmcsa_candidates'>> {
  const coverage: ResearchJobResult['coverage'] = [], context: ResearchJobResult['context'] = [];
  let oshaCandidates: ResearchJobResult['osha_candidates'], fmcsaCandidates: ResearchJobResult['fmcsa_candidates'];
  let financials: ResearchJobResult['financials'];
  const attempt = async (source: string, work: () => Promise<string | void>): Promise<void> => {
    try { const message = await work(); coverage.push({ source, state: 'complete', message: message || 'Public business evidence retrieved.' }); }
    catch (error) {
      console.error(`[business-research-job:${source}]`, error);
      coverage.push({ source, state: 'unavailable', message: error instanceof Error ? error.message : 'Public research could not be completed.' });
    }
  };
  const add = (label: string, value: string, url: string, category: 'fleet' | 'property' | 'weather' | 'workplace' = 'fleet'): void => {
    context.push({ category, label, value, url, fetched_at: new Date().toISOString() });
  };
  const dot = observations.find((item) => item.values.dot)?.values.dot;
  const nonprofit = observations.find((item) => item.source === 'irs' && item.values.ein);
  await Promise.all([
    nonprofit && linked ? attempt('irs_990', async () => {
      const ein = nonprofit.values.ein;
      if (!ein) throw new Error('IRS XML extraction requires the exact reported organizational EIN.');
      const indexSlot = await db.rpc('research_request_slot', { p_name: 'irs_990', p_seconds: 30 });
      if (indexSlot.error) throw databaseError(indexSlot.error);
      if (indexSlot.data !== true) throw new WorkspaceError('IRS filing research is paused or cooling down.', 429);
      const filing = nonprofit.values.filing_document ?? await findIrsFiling(ein, AbortSignal.timeout(30000));
      if (!filing) throw new Error('No supported IRS 990, 990EZ or 990-PF filing matched this exact EIN in the current index.');
      if (matchesIrsFinancials(previous?.financials, ein, filing)) { financials = previous.financials; return; }
      financials = await readIrsFinancials(ein, filing, AbortSignal.timeout(30000));
    }) : Promise.resolve(coverage.push({ source: 'irs_990', state: 'not_applicable',
      message: nonprofit ? 'Detailed tax-return enrichment runs only for saved or linked nonprofit leads.' : 'No matched nonprofit EIN.' })),
    attempt('osha', async () => {
      if (!oshaConfigured()) throw new Error('OSHA enrichment needs DOL_API_KEY in the server deployment.');
      const business = observations.find(({ values }) => values.street && values.city && values.state && values.zip);
      if (!business) throw new Error('OSHA matching needs a complete public business address.');
      const names = [...new Set(observations.filter((item) => item.values.name.trim().length >= 3)
        .map((item) => item.values.name.trim()))].slice(0, 4);
      const records = await oshaInspectionsByName(names, business.values.state,
        { priority, match: (inspection) => inspectionMatches(observations, inspection) });
      const matched = matchedWorkplaceInspections(observations, records.inspections);
      oshaCandidates = records.inspections.filter((inspection) => !matched.some((item) => item.activity_nr === inspection.activity_nr))
        .slice(0, 10).map(({ activity_nr, establishment, street, city, state, zip, open_date }) =>
          ({ activity_nr, establishment, street: street ?? null, city, state, zip: zip ?? null, open_date }));
      if (!matched.length) return records.total_inspections
        ? `DOL returned ${records.total_inspections} similar-name records, but none matched the reported establishment address. Confirm the OSHA establishment before using them.`
        : 'No inspection record was returned for the business names and state searched. This is not a nationwide or complete OSHA history.';
      for (const inspection of matched) {
        add('OSHA inspection (reported)', `${inspection.open_date?.slice(0, 10) ?? 'Date unavailable'}; case ${inspection.case_status ?? 'status unavailable'}.`
          + ` Serious ${inspection.violations_serious ?? 0} · willful ${inspection.violations_willful ?? 0} · repeat ${inspection.violations_repeat ?? 0} · other ${inspection.violations_other ?? 0}.`
          + (inspection.total_penalty ? ` Penalties $${inspection.total_penalty.toLocaleString('en-US')}.` : '')
          + ' Historical public inspection, not proof of current insurance, a claim or underwriting ineligibility.',
        `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${encodeURIComponent(inspection.activity_nr)}`, 'workplace');
      }
    }),
    attempt('fmcsa_qc', async () => {
      if (!fmcsaConfigured()) throw new Error('FMCSA safety enrichment needs FMCSA_WEBKEY in the server deployment.');
      let carrier: FmcsaRecord;
      if (dot) {
        carrier = await fmcsaGetCarrier(dot);
        if (carrier.dot_number !== dot) throw new Error('FMCSA returned a different DOT identity; safety facts were not linked.');
      } else {
        const observedNames = [...new Set(observations.filter((item) => item.values.name.trim().length >= 3)
          .map((item) => item.values.name.trim()))];
        const primary = observedNames[0];
        if (!primary) throw new Error('A reported business name is required for the DOT carrier search.');
        let rows: FmcsaCandidate[] = [];
        for (const name of [primary, ...observedNames.slice(1, 3)]) {
          rows = await fmcsaSearchByName(name, observations.find((item) => item.values.state)?.values.state);
          if (rows.some((item) => item.state?.toUpperCase() === observations.find((entry) => entry.values.state)?.values.state?.toUpperCase())) break;
        }
        const names = observedNames.map(businessNameKey).filter(Boolean);
        const state = observations.find((item) => item.values.state)?.values.state;
        const city = observations.find((item) => item.values.city)?.values.city;
        fmcsaCandidates = rows.filter((item) => {
          if (state && item.state?.toUpperCase() !== state.toUpperCase()) return false;
          return [item.legal_name, item.dba_name ?? ''].some((candidate) =>
            names.some((name) => namesAgree(name, candidate)));
        }).sort((a, b) => Number(b.city?.toLowerCase() === city?.toLowerCase()) - Number(a.city?.toLowerCase() === city?.toLowerCase()))
          .slice(0, 5);
        return fmcsaCandidates.length
          ? `Found ${fmcsaCandidates.length} possible same-name DOT carrier record${fmcsaCandidates.length === 1 ? '' : 's'} in ${state ?? 'the available area'}. Confirm the DOT number and address; name matches are not verified identities.`
          : 'No DOT carrier match was confirmed by name and state. A DOT number is needed to verify carrier safety details; businesses without motor-carrier registration will not have this record.';
      }
      const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dot ?? carrier.dot_number)}`;
      if (carrier.safety_rating) add('FMCSA safety rating (reported)', `${carrier.safety_rating}${carrier.safety_rating_date ? ` · ${carrier.safety_rating_date}` : ' · rating date unavailable'}`, url);
      if (carrier.operating_status) add('Operating status (reported)', carrier.operating_status, url);
      if (carrier.inspections_total !== null) add('FMCSA inspections (reported)', `${carrier.inspections_total}. Public snapshot, not an underwriting decision.`, url);
      if (carrier.crashes_total !== null) add('FMCSA crashes (reported)', `${carrier.crashes_total}. Crash involvement is not a determination of fault or insurance claims.`, url);
    }),
    attempt('location', async () => {
      if (!observations.some((item) => item.values.latitude !== null)) await researchRequestSlot(db, 'census_geocoder', 1);
      const location = await researchLocation(observations);
      if (!location) throw new Error('No sufficiently complete public business address or mapped location.');
      add('Business location', `${location.latitude}, ${location.longitude}. ${location.accuracy}`, location.url, 'property');
      await Promise.all([
        attempt('nws', async () => {
          await researchRequestSlot(db, 'nws', 1);
          const url = `https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`;
          const weather: unknown = JSON.parse(await researchSourceText(url));
          if (!isRecord(weather) || !Array.isArray(weather.features)) throw new Error('NWS response is unsupported.');
          if (!weather.features.length) add('Active NWS alerts', 'No active alerts were returned at retrieval. This is not a loss history or binding determination.', url, 'weather');
          for (const feature of weather.features.slice(0, 5)) {
            if (!isRecord(feature) || !isRecord(feature.properties) || typeof feature.properties.event !== 'string') throw new Error('NWS alert schema is unsupported.');
            add('NWS alert', `${feature.properties.event}; effective ${String(feature.properties.effective ?? 'unknown')}; expires ${String(feature.properties.expires ?? 'unknown')}. Not proof of a loss or carrier restriction.`, url, 'weather');
          }
        }),
        attempt('fema', async () => {
          await researchRequestSlot(db, 'fema', 1);
          const params = new URLSearchParams({ f: 'json', geometry: `${location.longitude},${location.latitude}`, geometryType: 'esriGeometryPoint',
            inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF', returnGeometry: 'false' });
          const url = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${params}`;
          const flood: unknown = JSON.parse(await researchSourceText(url));
          if (!isRecord(flood) || flood.error || !Array.isArray(flood.features)) throw new Error('FEMA flood-map response is unavailable or unsupported.');
          if (!flood.features.length) throw new Error('FEMA returned no mapped zone; do not infer low flood risk.');
          for (const feature of flood.features.slice(0, 5)) {
            if (!isRecord(feature) || !isRecord(feature.attributes) || typeof feature.attributes.FLD_ZONE !== 'string') throw new Error('FEMA zone schema is unsupported.');
            add('FEMA mapped flood zone', `${feature.attributes.FLD_ZONE}${feature.attributes.ZONE_SUBTY ? ` · ${feature.attributes.ZONE_SUBTY}` : ''}. Effective map date unavailable. ${location.accuracy} Not a certified flood determination.`, url, 'property');
          }
        }),
      ]);
    }),
  ]);
  return { research_version: BUSINESS_RESEARCH_VERSION, context, coverage, ...(financials ? { financials } : {}),
    ...(oshaCandidates?.length ? { osha_candidates: oshaCandidates } : {}),
    ...(fmcsaCandidates?.length ? { fmcsa_candidates: fmcsaCandidates } : {}) };
}

export const TRANSIENT_OSHA_GAP = /needs DOL_API_KEY|rate-limiting OSHA|OSHA check queued|request failed \((429|5\d\d)\)|aborted|timeout/i;

/** Runs the OIP's external checks for evidence that is not retained, such as a live Google Maps listing. */
export function liveResearch(db: SupabaseClient, evidence: ResearchEvidence[]): Promise<Pick<ResearchJobResult,
  'research_version' | 'coverage' | 'context' | 'financials' | 'osha_candidates' | 'fmcsa_candidates'>> {
  return enrich(db, evidence, null, false, true);
}
export const BUSINESS_RESEARCH_VERSION = 2;

/** Re-runs one saved profile once when its result predates the current source matching rules. */
export async function requeueOutdatedBusinessResearch(db: SupabaseClient, businessId: string, result: ResearchJobResult | null): Promise<boolean> {
  if (result?.research_version === BUSINESS_RESEARCH_VERSION) return false;
  const queued = await db.from('business_research_jobs').update({ state: 'pending', attempts: 0, due_at: new Date().toISOString(),
    updated_at: new Date().toISOString() }).eq('business_id', businessId).eq('state', 'complete').select('business_id');
  if (queued.error) throw databaseError(queued.error);
  return queued.data.length > 0;
}
const OSHA_RETRY_BATCH = 10;
const OSHA_RETRY_AFTER_MS = 15 * 60000;

/** Requeues completed research whose OSHA lookup failed for a temporary reason, so profiles fill in once DOL is reachable. */
export async function requeueTransientOshaGaps(db: SupabaseClient): Promise<number> {
  if (!oshaConfigured() || oshaCoolingDown()) return 0;
  const done = await db.from('business_research_jobs').select('business_id,updated_at,result').eq('state', 'complete')
    .lt('updated_at', new Date(Date.now() - OSHA_RETRY_AFTER_MS).toISOString()).order('updated_at').limit(200)
    .returns<Array<{ business_id: string; updated_at: string; result: ResearchJobResult | null }>>();
  if (done.error) throw databaseError(done.error);
  const ids = done.data.filter(({ result }) => result?.coverage.some((item) => item.source === 'osha' && item.state === 'unavailable'
    && TRANSIENT_OSHA_GAP.test(item.message))).slice(0, OSHA_RETRY_BATCH).map((job) => job.business_id);
  if (!ids.length) return 0;
  const queued = await db.from('business_research_jobs').update({ state: 'pending', attempts: 0, due_at: new Date().toISOString(),
    updated_at: new Date().toISOString() }).in('business_id', ids).eq('state', 'complete').select('business_id');
  if (queued.error) throw databaseError(queued.error);
  return queued.data.length;
}

/** Reopens one finished profile whose OSHA check hit a temporary DOL limit, so opening it fills OSHA in at priority. */
export async function requeueTransientOsha(db: SupabaseClient, businessId: string, result: ResearchJobResult | null): Promise<boolean> {
  if (!oshaConfigured() || oshaCoolingDown() || !result?.coverage.some((item) => item.source === 'osha' && item.state === 'unavailable'
    && TRANSIENT_OSHA_GAP.test(item.message))) return false;
  const queued = await db.from('business_research_jobs').update({ state: 'pending', attempts: 0, due_at: new Date().toISOString(),
    updated_at: new Date().toISOString() }).eq('business_id', businessId).eq('state', 'complete').select('business_id');
  if (queued.error) throw databaseError(queued.error);
  return queued.data.length > 0;
}

export async function runBusinessResearchJobs(db: SupabaseClient, businessId: string | null = null): Promise<{ processed: number; failed: number; partial: number }> {
  const claimed = await db.rpc('claim_business_research_jobs', { p_business: businessId }).returns<Job[]>();
  if (claimed.error) throw databaseError(claimed.error);
  if (!Array.isArray(claimed.data)) throw new WorkspaceError('Research job claims could not be verified.', 503);
  let processed = 0, failed = 0, partial = 0;
  await Promise.all(claimed.data.map(async (job) => {
    let observed: string | null = null;
    try {
      const profile = await researchProfile(db, job.actor_id, job.business_id), business = profile.business;
      if (!business) throw new Error('Research business is unavailable.');
      observed = business.updated_at;
      const settings = await db.from('business_research_settings').select('refresh_days').eq('id', 1).single();
      if (settings.error) throw databaseError(settings.error);
      const directoryUpdates = new Map<string, BusinessObservation>();
      for (const previous of business.observations.filter((item) => item.source === 'irs' || item.source === 'dol_5500' || item.source === 'osm' && item.index_partition)) {
        const current = await refreshDirectoryObservation(db, previous);
        if (JSON.stringify(current.values) !== JSON.stringify(previous.values) || current.source_as_of !== previous.source_as_of) {
          directoryUpdates.set(`${previous.source}:${previous.record_id}`, current);
        }
      }
      const stale = business.observations.filter((item) => directoryUpdates.has(`${item.source}:${item.record_id}`)
        || Date.now() - Date.parse(item.fetched_at) >= settings.data.refresh_days * 86400000);
      if (stale.length) {
        await Promise.all(stale.map(async (previous) => {
          const slot = await db.rpc('research_source_slot', { p_provider: previous.source });
          if (slot.error) throw databaseError(slot.error);
          if (slot.data !== true) throw new Error('Source refresh is paused or its request budget is busy.');
          if (previous.source === 'osm' && !previous.index_partition) await researchRequestSlot(db, 'overpass', 10);
          const observation = directoryUpdates.get(`${previous.source}:${previous.record_id}`) ?? (previous.source === 'irs' || previous.source === 'dol_5500' || previous.source === 'osm' && previous.index_partition
            ? await refreshDirectoryObservation(db, previous) : await refreshBusinessObservation(previous));
          const retained = await db.rpc('retain_research_observation', { p_actor: job.actor_id, p_identity: researchIdentity(observation), p_observation: observation });
          if (retained.error) throw databaseError(retained.error);
          if (retained.data !== business.id) throw new Error('Research refresh changed canonical business identity.');
        }));
        const deferred = await db.rpc('finish_business_research_job', { p_business: business.id, p_lease: job.lease,
          p_observed: observed, p_result: {}, p_error: null });
        if (deferred.error) throw databaseError(deferred.error);
        return;
      }
      const carriers = await db.from('carrier_appetite_documents').select('id,revision,state,values,approved_by,approved_at')
        .eq('state', 'active').limit(1001).returns<CarrierAppetiteDocument[]>();
      if (carriers.error) throw databaseError(carriers.error);
      if (carriers.data.length > 1000) throw new Error('Active carrier documents need a scoped evaluation before matching.');
      const { facts, current } = researchMatchingFacts(business.observations);
      const market = evaluateOpportunity({ ...EMPTY_OPPORTUNITY_PROFILE, facts }, carriers.data, {
        scope_key: `business:${business.id}`, record_name: business.name, version: 0, findings: { ...EMPTY_DOSSIER_FINDINGS },
        confirmations: [], observations: [], observations_total: 0, history_total: 0, page: 0,
      }, new Date().toISOString().slice(0, 10), current);
      let previous: ResearchJobResult | null = null;
      if (profile.linked_record) {
        const stored = await db.from('business_research_jobs').select('result').eq('business_id', business.id).single<{ result: ResearchJobResult | null }>();
        if (stored.error) throw databaseError(stored.error);
        previous = stored.data.result;
      }
      const external = await enrich(db, business.observations, previous, Boolean(profile.linked_record), businessId !== null);
      const result: ResearchJobResult = { research_version: BUSINESS_RESEARCH_VERSION,
        insights: researchInsights(business.observations), market_fit: market, ...external };
      if (profile.linked_record) {
        const task = await db.rpc('create_business_research_task', { p_business: business.id, p_lease: job.lease,
          p_kind: business.observations.some((item) => item.values.phone || item.values.email) ? 'business_review' : 'contact_research' });
        if (task.error) throw databaseError(task.error);
      }
      const saved = await db.rpc('finish_business_research_job', { p_business: business.id, p_lease: job.lease,
        p_observed: observed, p_result: result, p_error: null });
      if (saved.error) throw databaseError(saved.error);
      if (saved.data === true) {
        processed++;
        if (result.coverage.some((item) => item.state === 'unavailable')) partial++;
      }
    } catch (error) {
      failed++;
      console.error('[business-research-job]', job.business_id, error);
      const saved = await db.rpc('finish_business_research_job', { p_business: job.business_id, p_lease: job.lease,
        p_observed: observed, p_result: null, p_error: 'Business research failed. The agency owner can inspect the research run and retry.' });
      if (saved.error) throw databaseError(saved.error);
    }
  }));
  return { processed, failed, partial };
}
