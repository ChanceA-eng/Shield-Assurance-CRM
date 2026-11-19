import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_BUSINESS_SEARCH } from '@crm/shared';
import { googleForFilters, googleKeyword, googlePlaceInput, searchGooglePlaces } from './google-places';

function slots(existing: number) {
  const rows = new Set<string>(Array.from({ length: existing }, (_, index) => `google_places:${new Date().toISOString().slice(0, 7)}:old-${index}`));
  const db = {
    from: () => ({
      insert: async (row: { name: string }) => { rows.add(row.name); return { error: null }; },
      select: () => ({ like: async (_: string, pattern: string) => ({ error: null, count: [...rows].filter((name) => name.startsWith(pattern.slice(0, -1))).length }) }),
      delete: () => ({ eq: async (_: string, name: string) => { rows.delete(name); return { error: null }; } }),
    }),
  };
  return { db: db as unknown as SupabaseClient, rows };
}
const listing = (id: string, name: string, address: string, latitude: number, longitude: number, phone: string | null = '(520) 555-0101') => ({
  id, displayName: { text: name }, formattedAddress: address, nationalPhoneNumber: phone, location: { latitude, longitude },
});
const respond = (places: unknown[], nextPageToken?: string) => vi.fn(async () => new Response(JSON.stringify({ places, nextPageToken }), { status: 200 }));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('google places', () => {
  it('validates a listing posted back from the browser', () => {
    expect(() => googlePlaceInput({ id: 'short', name: 'X' })).toThrow(/Google Maps business/);
    expect(() => googlePlaceInput({ id: 'ChIJ1234567890', name: '' })).toThrow(/invalid/);
    expect(googlePlaceInput({ id: 'ChIJ1234567890', name: ' Desert Plumbing ', website: 'javascript:alert(1)', latitude: 32.2, longitude: -110.9, rating: 4.5 }))
      .toMatchObject({ name: 'Desert Plumbing', website: null, latitude: 32.2, longitude: -110.9, rating: 4.5, phone: null });
  });

  it('derives the keyword from the query, NAICS title or industry', () => {
    expect(googleKeyword({ ...EMPTY_BUSINESS_SEARCH, query: ' roofing ', naics: '238220' })).toBe('roofing');
    expect(googleKeyword({ ...EMPTY_BUSINESS_SEARCH, naics: '238220' })).toMatch(/Plumbing/);
    expect(googleKeyword({ ...EMPTY_BUSINESS_SEARCH, industry: 'restaurant' })).toBe('restaurant');
    expect(googleKeyword({ ...EMPTY_BUSINESS_SEARCH, state: 'AZ' })).toBeNull();
  });

  it('reports setup without calling Google or using quota', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { db, rows } = slots(0);
    await expect(searchGooglePlaces(db, { textQuery: 'plumber', rectangle: null, page_token: '' })).resolves.toMatchObject({ configured: false });
    expect(fetcher).not.toHaveBeenCalled(); expect(rows.size).toBe(0);
  });

  it('refuses and releases the reservation when the monthly cap is reached', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key'); vi.stubEnv('GOOGLE_PLACES_MONTHLY_CAP', '2');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { db, rows } = slots(2);
    await expect(searchGooglePlaces(db, { textQuery: 'plumber', rectangle: null, page_token: '' })).rejects.toMatchObject({ status: 429 });
    expect(rows.size).toBe(2); expect(fetcher).not.toHaveBeenCalled();
  });

  it('searches the chosen city and drops out-of-state, wrong-ZIP and contactless listings', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    const fetcher = respond([
      listing('p1', 'Desert Plumbing', '1 Main St, Tucson, AZ 85705, USA', 32.25, -110.97),
      listing('p2', 'Border Plumbing', '9 Main St, Las Cruces, NM 88001, USA', 32.3, -106.7),
      listing('p3', 'Other Zip Plumbing', '5 Oak St, Tucson, AZ 85710, USA', 32.2, -110.8),
      listing('p4', 'Quiet Plumbing', '7 Elm St, Tucson, AZ 85705, USA', 32.26, -110.96, null),
    ], 'next');
    vi.stubGlobal('fetch', fetcher);
    const result = await googleForFilters(slots(0).db, { ...EMPTY_BUSINESS_SEARCH, naics: '238220', state: 'AZ', city: 'Tucson', zip: '85705', contact: 'phone' }, 'tok');
    expect(result).toMatchObject({ state: 'complete', next_page_token: 'next', places: [{ id: 'p1', latitude: 32.25, distance_miles: null }] });
    expect(result.places).toHaveLength(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: expect.stringMatching(/Plumbing.* in Tucson, AZ 85705$/), pageToken: 'tok' });
  });

  it('restricts a radius search to a rectangle and keeps only listings inside the circle, with distance', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    const fetcher = respond([
      listing('near', 'Near Plumbing', '1 Main St, Tucson, AZ 85705, USA', 32.16, -110.87),
      listing('far', 'Far Plumbing', '1 Main St, Marana, AZ 85653, USA', 32.45, -111.2),
    ]);
    vi.stubGlobal('fetch', fetcher);
    const result = await googleForFilters(slots(0).db, { ...EMPTY_BUSINESS_SEARCH, query: 'plumber', state: 'AZ', city: 'Tucson', place_id: '0477000', radius_miles: '5' }, '');
    expect(result.places.map((item) => item.id)).toEqual(['near']);
    expect(result.places[0].distance_miles).toBeLessThan(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: 'plumber', locationRestriction: { rectangle: expect.any(Object) } });
  });

  it('skips Google for filing-only filters and turns failures into coverage instead of errors', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })));
    await expect(googleForFilters(slots(0).db, { ...EMPTY_BUSINESS_SEARCH, state: 'AZ', city: 'Tucson', benefits: 'any' }, '')).resolves.toMatchObject({ state: 'not_applicable' });
    await expect(googleForFilters(slots(0).db, { ...EMPTY_BUSINESS_SEARCH, query: 'plumber', state: 'AZ' }, '')).resolves.toMatchObject({ state: 'unavailable', message: /quota/ });
  });
});