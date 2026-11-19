import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_BUSINESS_SEARCH, type CarrierAppetiteDocument } from '@crm/shared';
import { linkGooglePlaces, researchReadiness, searchBusinesses, researchProfile, refreshResearchMarketFit } from './business-research-server';
import { runBusinessResearchJobs } from './business-research-jobs';
import { mappedBusinessObservation } from './business-research-sources';

const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6', business = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
let db: SupabaseClient, calls: Array<{ path: string; body: Record<string, unknown> }>, external: string[];
let active: boolean, enabled: boolean, cached: unknown, sourceEnabled: boolean, providerFailure: boolean;
let claimed: Array<{ business_id: string; actor_id: string; lease: string }>;
let indexedMap: boolean;
let carrierCount: number | null;
let carrierDocuments: CarrierAppetiteDocument[];
let directoryRows: unknown[], profileObservations: unknown[];
beforeEach(() => {
  active = true; enabled = true; cached = null; sourceEnabled = true; providerFailure = false; calls = []; external = []; claimed = []; indexedMap = false;
  carrierCount = 0; carrierDocuments = []; directoryRows = []; profileObservations = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    external.push(String(input));
    if (providerFailure) return new Response('Unavailable', { status: 503 });
    return new Response(JSON.stringify([{ dot_number: '12345', legal_name: 'Synthetic Fleet', phy_state: 'AZ', phy_city: 'Tucson' }]));
  }));
  db = createClient('https://example.invalid', 'synthetic', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname.split('/').pop() ?? '', body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      let data: unknown;
      if (path === 'agency_members') data = { active, role: 'agent', user_id: actor };
      else if (path === 'business_research_settings') data = { enabled, refresh_days: 7 };
      else if (path === 'business_research_sources') data = [{ provider: indexedMap ? 'osm' : 'fmcsa_census', enabled: sourceEnabled, retained_rights: true }];
      else if (path === 'queue_business_research_partition') data = { active_version: 'synthetic-map', building_version: 'synthetic-map', status: 'complete', cursor: 3000000 };
      else if (path === 'business_research_territories') data = { bounds: { south: 32, west: -111, north: 33, east: -110 } };
      else if (path === 'browse_business_research_map_index') data = [{ observation: mappedBusinessObservation('node/12345', { name: 'Synthetic Restaurant', amenity: 'restaurant' }, 32.2, -110.9, null) }];
      else if (path === 'business_research_runs') data = cached;
      else if (path === 'business_research_partitions') data = [{ provider: 'osm', state: 'AZ', active_version: 'v1', building_version: null }];
      else if (path === 'business_research_directory_records') data = directoryRows;
      else if (path === 'research_source_slot') data = true;
      else if (path === 'research_request_slot') data = true;
      else if (path === 'claim_business_research_jobs') data = claimed;
      else if (path === 'finish_business_research_job') data = true;
      else if (path === 'carrier_appetite_documents') {
        if (init?.method === 'HEAD') return new Response(null, { headers: carrierCount === null ? {} : { 'Content-Range': `*/${carrierCount}` } });
        data = carrierDocuments;
      }
      else if (path === 'retain_research_search') data = { id: body.p_run, business_ids: [business], coverage: body.p_coverage, has_more: false };
      else if (path === 'get_business_research') data = { business: { id: business, name: 'Synthetic Fleet', observations: profileObservations, updated_at: new Date().toISOString(), status: 'partial' }, job: { state: 'pending', error: null }, linked_record: null };
      else throw new Error(`Unexpected database request: ${path}`);
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    },
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const filters = { ...EMPTY_BUSINESS_SEARCH, industry: 'trucking', state: 'AZ', city: 'Tucson' };
describe('durable business search orchestration', () => {
  it('recomputes profile recommendations against the latest saved guide without another AI or public-source request', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const observation = mappedBusinessObservation('node/12345', { name: 'Synthetic Fleet' }, 32.2, -110.9, today);
    observation.values = { ...observation.values, classification: 'reported', state: 'AZ', power_units: 12, registration_reported_on: today };
    profileObservations = [observation];
    carrierDocuments = [{
      id: 'synthetic-auto', revision: 3, state: 'active', file_name: 'synthetic.pdf', storage_path: '', pages: [],
      approved_by: actor, approved_at: `${today}T00:00:00Z`,
      values: { carrier: 'Synthetic Carrier', title: 'Fleet', line: 'Commercial auto', states: 'AZ', effective_on: '', expires_on: '',
        access: 'direct', access_reference: '', rights_reference: '',
        rules: [{ id: 'fleet', criterion: '11+ power units', page: 1, excerpt: '11+ power units', decision: 'eligible',
          predicate: { field: 'power_units', operator: 'gte', value: '11' } }] },
    }];
    const profile = await researchProfile(db, actor, business);
    await refreshResearchMarketFit(db, profile);
    expect(profile.job?.result?.market_fit?.markets[0].recommendation).toContain('Worth reviewing for Commercial auto');
    carrierDocuments[0].revision = 4;
    carrierDocuments[0].values.rules[0].predicate!.value = '20';
    await refreshResearchMarketFit(db, profile);
    expect(profile.job?.result?.market_fit?.markets[0].recommendation).toContain('More information needed');
    expect(profile.job?.result?.market_fit?.markets[0].revision).toBe(4);
    expect(external).toEqual([]);
  });
  it('reports live carrier and safety readiness without exposing API keys or querying public sources', async () => {
    vi.stubEnv('DOL_API_KEY', ''); vi.stubEnv('FMCSA_WEBKEY', '');
    expect(await researchReadiness(db)).toEqual({ active_carrier_documents: 0, osha_configured: false, fmcsa_configured: false });
    carrierCount = 2;
    vi.stubEnv('DOL_API_KEY', 'synthetic-dol-key'); vi.stubEnv('FMCSA_WEBKEY', 'synthetic-fmcsa-key');
    expect(await researchReadiness(db)).toEqual({ active_carrier_documents: 2, osha_configured: true, fmcsa_configured: true });
    expect(external).toEqual([]);
  });
  it('does not present a missing carrier-document count as an empty successful setup', async () => {
    carrierCount = null;
    await expect(researchReadiness(db)).rejects.toThrow('Carrier appetite readiness could not be loaded');
  });
  it('automatically chooses applicable sources, retains canonical observations and does not create leads or tasks', async () => {
    const result = await searchBusinesses(db, actor, filters, 0, business);
    expect(result.businesses.map((item) => item.id)).toEqual([business]);
    expect(external).toHaveLength(1);
    const retained = calls.find((item) => item.path === 'retain_research_search');
    expect(retained?.body.p_items).toEqual([expect.objectContaining({ identity: expect.stringMatching(/^[a-f0-9]{64}$/),
      observation: expect.objectContaining({ source: 'fmcsa_census', record_id: '12345' }) })]);
    expect(calls.some((item) => ['save_research_business', 'tasks', 'leads', 'outreach_outbox'].includes(item.path))).toBe(false);
  });
  it('reuses durable research without making another source request', async () => {
    cached = { id: business, business_ids: [business], coverage: [{ source: 'fmcsa_census', state: 'partial', message: 'Public registrations' }], has_more: false };
    expect((await searchBusinesses(db, actor, filters, 0)).businesses).toHaveLength(1);
    expect(external).toEqual([]);
    expect(calls.some((item) => item.path === 'retain_research_search')).toBe(false);
  });
  it('uses indexed open-map pagination and exact category filtering without public-server calls or request cooldowns', async () => {
    indexedMap = true;
    const result = await searchBusinesses(db, actor, { ...EMPTY_BUSINESS_SEARCH, naics: '722511', state: 'AZ', city: 'Tucson' }, 4);
    expect(result.businesses).toHaveLength(1);
    expect(calls.find((item) => item.path === 'browse_business_research_map_index')?.body).toMatchObject({
      p_tag_key: 'amenity', p_tag_pattern: '^restaurant$', p_page: 1,
      p_city: 'Tucson', p_bounds: null,
    });
    expect(calls.some((item) => ['research_source_slot', 'research_request_slot'].includes(item.path))).toBe(false);
    expect(external).toEqual([]);
  });
  it('browses public indexed businesses with every filter empty and does not resolve or invent geography', async () => {
    indexedMap = true;
    expect((await searchBusinesses(db, actor, EMPTY_BUSINESS_SEARCH, 0)).businesses).toHaveLength(1);
    expect(calls.find((item) => item.path === 'browse_business_research_map_index')?.body).toMatchObject({
      p_state: '', p_city: '', p_bounds: null, p_tag_key: null, p_tag_pattern: null,
    });
    expect(calls.some((item) => ['queue_business_research_partition', 'business_research_territories', 'research_request_slot'].includes(item.path))).toBe(false);
    expect(external).toEqual([]);
  });
  it('filters by state and official contractor category without requiring a city or upstream geocoder', async () => {
    indexedMap = true;
    await searchBusinesses(db, actor, { ...EMPTY_BUSINESS_SEARCH, state: 'AZ', naics: '238220', zip: '85705' }, 0);
    expect(calls.find((item) => item.path === 'browse_business_research_map_index')?.body).toMatchObject({
      p_state: 'AZ', p_city: '', p_zip: '85705', p_tag_key: 'craft', p_tag_pattern: '^(plumber|hvac)$', p_bounds: null,
    });
    expect(external).toEqual([]);
  });
  it('does not hold an empty warming index result in the fifteen-minute search cache', async () => {
    cached = { id: business, business_ids: [], coverage: [{ source: 'fmcsa_census', state: 'partial', message: 'Indexing' }], has_more: false };
    expect((await searchBusinesses(db, actor, filters, 0)).businesses).toHaveLength(1);
    expect(external).toHaveLength(1);
    expect(calls.some((item) => item.path === 'retain_research_search')).toBe(true);
  });
  it('retains the fourth source window rather than dropping results after the first 75 businesses', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `168413e9-a6a4-4dff-a8bf-${String(index).padStart(12, '0')}`);
    cached = { id: business, business_ids: ids, coverage: [], has_more: true };
    const result = await searchBusinesses(db, actor, filters, 3);
    expect(calls.filter((item) => item.path === 'get_business_research').map((item) => item.body.p_business)).toEqual(ids.slice(75, 100));
    expect(result.next_page).toBe(4);
    expect(external).toEqual([]);
  });
  it('blocks inactive users and paused research before public acquisition', async () => {
    active = false;
    await expect(searchBusinesses(db, actor, filters, 0)).rejects.toThrow('Active agency membership');
    expect(external).toEqual([]);
    active = true; enabled = false;
    await expect(searchBusinesses(db, actor, filters, 0)).rejects.toThrow('discovery is paused');
    expect(external).toEqual([]);
  });
  it('does not turn disabled or failed providers into successful empty searches', async () => {
    sourceEnabled = false;
    await expect(searchBusinesses(db, actor, filters, 0)).rejects.toThrow('paused by the agency owner');
    sourceEnabled = true; providerFailure = true;
    await expect(searchBusinesses(db, actor, filters, 0)).rejects.toThrow('HTTP 503');
    expect(calls.some((item) => item.path === 'retain_research_search')).toBe(false);
  });
  it('does not perform external or CRM work when no research lease is available', async () => {
    expect(await runBusinessResearchJobs(db)).toEqual({ processed: 0, failed: 0, partial: 0 });
    expect(external).toEqual([]);
    expect(calls.map((item) => item.path)).toEqual(['claim_business_research_jobs']);
  });
  it('persists unavailable enrichment explicitly as partial research without creating pipeline or outreach records', async () => {
    claimed = [{ business_id: business, actor_id: actor, lease: '168413e9-a6a4-4dff-a8bf-8f8df83dace8' }];
    expect(await runBusinessResearchJobs(db, business)).toEqual({ processed: 1, failed: 0, partial: 1 });
    const finished = calls.find((item) => item.path === 'finish_business_research_job');
    expect(finished?.body.p_result).toMatchObject({ market_fit: { status: 'needs_review', score: { evidence: 0, contactability: 0 } },
      coverage: expect.arrayContaining([expect.objectContaining({ source: 'location', state: 'unavailable' })]) });
    expect(external).toEqual([]);
    expect(calls.some((item) => ['create_business_research_task', 'save_research_business', 'leads', 'outreach_outbox'].includes(item.path))).toBe(false);
  });
  it('links a Google listing to its matching record anywhere in the current state index and retains only that record', async () => {
    indexedMap = true;
    const match = mappedBusinessObservation('node/1', { name: 'Desert Plumbing Co', craft: 'plumber', phone: '+1 520 555 0101' }, 32.2, -110.9, null);
    const other = mappedBusinessObservation('node/2', { name: 'Desert Rose Bakery', shop: 'bakery', phone: '+1 520 555 0199' }, 32.4, -110.7, null);
    directoryRows = [{ provider: 'osm', version: 'v1', observation: match }, { provider: 'osm', version: 'v1', observation: other },
      { provider: 'osm', version: 'stale', observation: match }];
    profileObservations = [match];
    const place = { id: 'ChIJ1', name: 'Desert Plumbing', address: '1 Main St, Tucson, AZ 85705, USA', phone: '(520) 555-0101', website: null,
      maps_url: null, category: 'Plumber', rating: null, rating_count: null, status: null, latitude: 32.2, longitude: -110.9 };
    expect(await linkGooglePlaces(db, actor, [place], { ...EMPTY_BUSINESS_SEARCH, state: 'AZ' })).toEqual([expect.objectContaining({ id: business, google: place })]);
    expect(calls.find((item) => item.path === 'retain_research_search')?.body.p_items).toEqual([{ identity: expect.any(String), observation: match }]);
    expect(external).toEqual([]);
  });
});
