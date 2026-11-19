import { describe, expect, it } from 'vitest';
import { milesBetween, radiusCenter, radiusCities } from './research-geography';

describe('research radius', () => {
  const tucson = { state: 'AZ', place_id: '0477000', radius_miles: '10' };
  it('centers on the chosen city and lists nearby places nearest first', () => {
    expect(radiusCenter(tucson)).toMatchObject({ radius_miles: 10, latitude: expect.closeTo(32.15, 1) });
    const cities = radiusCities(tucson) ?? [];
    expect(cities[0]).toBe('TUCSON');
    expect(cities).toContain('SOUTH TUCSON');
    expect(cities).not.toContain('PHOENIX');
    expect(radiusCities({ ...tucson, radius_miles: '' })).toBeNull();
  });
  it('measures miles between points', () => {
    expect(milesBetween({ latitude: 32.2226, longitude: -110.9747 }, { latitude: 33.4484, longitude: -112.074 })).toBeCloseTo(105, -1);
  });
});