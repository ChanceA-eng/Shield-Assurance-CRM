import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/intelligence/public-records/route';
import { getSupabaseServerClient } from './supabase-server';
import { fmcsaSearchByName } from './enrichment';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: 'actor' }, error: null }) }));
const source = '168413e9-a6a4-4dff-a8bf-8f8df83dace6', requestId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const batch = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
const carrier = () => ({ dotNumber: 12345, legalName: 'Synthetic Transport', telephone: '520-555-0101',
  phyStreet: '1 Synthetic Street', phyCity: 'Tucson', phyState: 'AZ', phyZip: '85701',
  totalPowerUnits: 12, totalDrivers: 15, mcs150Date: '10/01/2026', statusCode: 'A' });
let calls: Array<{ path: string; body: Record<string, unknown> }>, providerCalls: URL[];
let rows: unknown[], selected: Record<string, unknown>, previous: Record<string, unknown> | null;
let active: boolean, sourceActive: boolean, provider: string, loseResponse: boolean, invalidPayload: boolean;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('FMCSA_WEBKEY', 'synthetic-key');
  calls = []; providerCalls = []; rows = [{ carrier: carrier() }]; selected = carrier(); previous = null;
  active = true; sourceActive = true; provider = 'fmcsa'; loseResponse = false; invalidPayload = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); providerCalls.push(url);
    if (url.hostname !== 'mobile.fmcsa.dot.gov') throw new Error('Unexpected public-record host.');
    return new Response(JSON.stringify(invalidPayload ? { message: 'Unexpected payload' }
      : { content: url.pathname.includes('/name/') ? rows : { carrier: selected } }), { headers: { 'Content-Type': 'application/json' } });
  }));
  const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname.split('/').pop() ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path, body });
      let data: unknown;
      switch (path) {
        case 'agency_members': data = { active, role: 'agent', user_id: 'actor' }; break;
        case 'discovery_sources': data = { active: sourceActive, acquisition_until: '2099-12-31', provider }; break;
        case 'import_batches': data = previous; break;
        case 'intelligence_import_matches': data = [{ index: 0, matches: [] }]; break;
        case 'acquire_discovery_file':
          previous = { id: batch, discovery_source_id: body.p_source, discovery_fingerprint: body.p_fingerprint, prospect_count: 1 };
          data = loseResponse ? null : { batch_id: batch, prospect_count: 1, already_acquired: false };
          break;
        default: throw new Error(`Unexpected discovery write: ${path}`);
      }
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const get = (extra = '') => GET(new NextRequest(`http://localhost/api/intelligence/public-records?source_id=${source}&query=Synthetic&state=AZ${extra}`));
const post = (overrides = {}) => POST(new NextRequest('http://localhost/api/intelligence/public-records', {
  method: 'POST', body: JSON.stringify({ source_id: source, request_id: requestId, dot_number: '12345', ...overrides }),
}));

describe('government business search', () => {
  it('searches the real provider contract and strictly filters state instead of substituting another state', async () => {
    rows = [{ carrier: { ...carrier(), phyState: 'CA' } }];
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ businesses: [], next_start: null });
    expect(providerCalls[0].searchParams.get('webKey')).toBe('synthetic-key');
    expect(providerCalls[0].searchParams.get('size')).toBe('50');
    expect(calls.some((call) => call.path === 'acquire_discovery_file')).toBe(false);
  });
  it('preserves reported business contacts, fleet and registration dates without policy or contact-verification claims', async () => {
    const response = await get();
    expect(await response.json()).toMatchObject({ businesses: [{ dot_number: '12345', phone: '520-555-0101',
      address: '1 Synthetic Street, Tucson, AZ, 85701', power_units: 12, drivers: 15, registration_reported_on: '2026-10-01' }] });
    expect(JSON.stringify(await (await get()).json())).not.toContain('synthetic-key');
  });
  it('retains the provider cursor even when every business on a page is outside the state', async () => {
    rows = Array.from({ length: 50 }, (_, index) => ({ carrier: { ...carrier(), dotNumber: 10000 + index, phyState: 'CA' } }));
    const response = await get('&start=50');
    expect(await response.json()).toMatchObject({ businesses: [], next_start: 100 });
    expect(providerCalls[0].searchParams.get('start')).toBe('50');
  });
  it('reuses the same provider parser for existing lead name enrichment', async () => {
    expect(await fmcsaSearchByName('Synthetic', 'AZ')).toEqual([expect.objectContaining({
      dot_number: '12345', legal_name: 'Synthetic Transport', dba_name: null, city: 'Tucson', state: 'AZ',
      physical_address: '1 Synthetic Street, Tucson, AZ, 85701', phone: '520-555-0101', power_units: 12, drivers: 15,
    })]);
  });
  it.each(['&industry=Contractor', '&start=-1', '&start=1.5'])('rejects unsupported targeting before retrieval: %s', async (extra) => {
    expect((await get(extra)).status).toBe(400);
    expect(providerCalls).toHaveLength(0);
  });
  it('reports missing credentials or malformed provider responses as failures rather than empty search success', async () => {
    vi.stubEnv('FMCSA_WEBKEY', '');
    expect((await get()).status).toBe(503);
    expect(providerCalls).toHaveLength(0);
    vi.stubEnv('FMCSA_WEBKEY', 'synthetic-key'); invalidPayload = true;
    expect((await get()).status).toBe(503);
  });
});

describe('reviewed public-record acquisition', () => {
  it('re-fetches selected DOT facts server-side, matches the full book, and stages once without accepting client-supplied facts', async () => {
    vi.stubEnv('FMCSA_WEBKEY', 'synthetic+key/with=symbols');
    expect((await post({ full_name: 'Spoofed', phone: 'untrusted' })).status).toBe(201);
    expect(providerCalls[0].searchParams.get('webKey')).toBe('synthetic+key/with=symbols');
    const saved = calls.find((call) => call.path === 'acquire_discovery_file')?.body;
    expect(saved).toMatchObject({ p_source: source, p_request: requestId, p_prospects: [
      expect.objectContaining({ full_name: 'Synthetic Transport', phone: '520-555-0101', payload: {
        profile: expect.objectContaining({ public_source: expect.objectContaining({ evidence_class: 'public_record', registration_reported_on: '2026-10-01' }),
          dot: { number: '12345' } }), raw: [], duplicate_matches: [],
      } }),
    ] });
    expect((await post()).status).toBe(200);
    expect(providerCalls).toHaveLength(1);
    expect(calls.filter((call) => call.path === 'acquire_discovery_file')).toHaveLength(1);
    expect(calls.some((call) => /send|enroll|consent|outbox/.test(call.path))).toBe(false);
  });
  it('reconciles an uncertain saved response without another provider lookup or staged record', async () => {
    loseResponse = true;
    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(200);
    expect(providerCalls).toHaveLength(1);
    expect(calls.filter((call) => call.path === 'acquire_discovery_file')).toHaveLength(1);
  });
  it('keeps businesses without a reported contact as research candidates and refuses a different returned DOT', async () => {
    selected = { ...carrier(), telephone: null };
    expect((await post()).status).toBe(201);
    const saved = calls.find((call) => call.path === 'acquire_discovery_file')?.body;
    expect(saved?.p_prospects).toEqual([expect.objectContaining({ phone: null, email: null })]);
    previous = null; selected = { ...carrier(), dotNumber: 67890 };
    expect((await post()).status).toBe(502);
  });
  it('rejects reusing a request identity for another business', async () => {
    expect((await post()).status).toBe(201);
    expect((await post({ dot_number: '67890' })).status).toBe(409);
    expect(providerCalls).toHaveLength(1);
  });
  it('requires active membership and correct current source approval before every provider lookup or replay', async () => {
    active = false;
    expect((await get()).status).toBe(403);
    active = true; provider = 'file';
    expect((await post()).status).toBe(403);
    provider = 'fmcsa'; sourceActive = false;
    expect((await post()).status).toBe(403);
    expect(providerCalls).toHaveLength(0);
  });
});
