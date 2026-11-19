import { describe, expect, it } from 'vitest';
import { getReportDateRange, getReportPeriodStarts, isReportRangeKey } from './reporting-range';

describe('reporting date ranges', () => {
  const now = new Date('2026-11-05T23:16:00.000Z');

  it('uses the current month, calendar year and calendar quarter boundaries', () => {
    expect(getReportDateRange('mtd', now)).toEqual({ start: '2026-11-01', end: '2026-11-05' });
    expect(getReportDateRange('ytd', now)).toEqual({ start: '2026-01-01', end: '2026-11-05' });
    expect(getReportDateRange('qtd', now)).toEqual({ start: '2026-10-01', end: '2026-11-05' });
    expect(getReportPeriodStarts(now)).toEqual({ month: '2026-11-01', year: '2026-01-01' });
  });

  it('includes exactly twelve calendar months in the rolling period', () => {
    expect(getReportDateRange('12m', now)).toEqual({ start: '2025-12-01', end: '2026-11-05' });
  });

  it('uses the agency local date near UTC month and year boundaries', () => {
    const shortlyAfterUtcMidnight = new Date('2027-01-01T01:00:00.000Z');
    expect(getReportDateRange('mtd', shortlyAfterUtcMidnight, 'America/New_York'))
      .toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(getReportPeriodStarts(shortlyAfterUtcMidnight, 'America/New_York'))
      .toEqual({ month: '2026-12-01', year: '2026-01-01' });
  });

  it('rejects unknown range values', () => {
    expect(isReportRangeKey('qtd')).toBe(true);
    expect(isReportRangeKey('year')).toBe(false);
    expect(isReportRangeKey(null)).toBe(false);
  });
});
