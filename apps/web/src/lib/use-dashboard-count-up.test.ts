import { describe, expect, it } from 'vitest';
import { dashboardCountAt, DASHBOARD_COUNT_UP_MS } from './use-dashboard-count-up';

describe('dashboard count-up', () => {
  it('counts linearly from zero to the exact target in one second', () => {
    expect(DASHBOARD_COUNT_UP_MS).toBe(1000);
    expect(dashboardCountAt(12345.67, 0)).toBe(0);
    expect(dashboardCountAt(100, 250)).toBe(25);
    expect(dashboardCountAt(100, 500)).toBe(50);
    expect(dashboardCountAt(100, 999)).toBeLessThan(100);
    expect(dashboardCountAt(12345.67, 1000)).toBe(12345.67);
    expect(dashboardCountAt(12345.67, 1500)).toBe(12345.67);
  });

  it('keeps zero stable and clamps times before the start', () => {
    expect(dashboardCountAt(0, 500)).toBe(0);
    expect(dashboardCountAt(100, -10)).toBe(0);
  });
});
