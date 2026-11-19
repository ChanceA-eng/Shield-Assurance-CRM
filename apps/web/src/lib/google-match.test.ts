import { describe, expect, it } from 'vitest';
import type { GooglePlace } from '@crm/shared';
import { businessNameKey, googleAddress, googleMatchesRecord } from './google-match';

const place = (overrides: Partial<GooglePlace> = {}): GooglePlace => ({ id: 'ChIJ1234567890', name: 'Desert Plumbing LLC', address: '1234 N Main St, Tucson, AZ 85705, USA',
  phone: '(520) 555-0101', website: null, maps_url: null, category: null, rating: null, rating_count: null, status: null, latitude: 32.25, longitude: -110.97, ...overrides });
const values = (overrides: Record<string, unknown> = {}) => ({ values: { name: 'DESERT PLUMBING, INC.', street: '1234 N MAIN ST', zip: '85705', phone: null,
  latitude: null, longitude: null, ...overrides } }) as never;

describe('google match', () => {
  it('normalizes names and parses US formatted addresses', () => {
    expect(businessNameKey('The Desert Plumbing, L.L.C.')).toBe(businessNameKey('DESERT PLUMBING INC'));
    expect(googleAddress('1234 N Main St, Tucson, AZ 85705-1234, USA')).toEqual({ street: '1234 N Main St', number: '1234', zip: '85705', city: 'Tucson', state: 'AZ' });
  });

  it('matches on an identical phone or on agreeing names plus a corroborating location', () => {
    expect(googleMatchesRecord(place({ name: 'Unrelated Name' }), [values({ name: 'Other', zip: '99999', phone: '1-520-555-0101' })])).toBe(true);
    expect(googleMatchesRecord(place(), [values()])).toBe(true);
    expect(googleMatchesRecord(place({ address: '9 Elm St, Phoenix, AZ 85001, USA' }), [values({ street: '10 ELM', zip: '85002', latitude: 33.4, longitude: -112 })])).toBe(false);
    expect(googleMatchesRecord(place(), [values({ name: 'Cactus Roofing' })])).toBe(false);
    expect(googleMatchesRecord(place({ address: null }), [values({ street: null, zip: null, latitude: 32.251, longitude: -110.971 })])).toBe(true);
  });
});