import { describe, expect, it } from 'vitest';
import { agencyDateTimeInput, agencyHour, agencyInputToIso, endOfAgencyDay, isAgencyTimeZone, nextAgencyBusinessMorning, startOfAgencyDay } from './agency-time';

describe('agency time zones', () => {
  it('accepts only configured IANA time zones', () => {
    expect(isAgencyTimeZone('America/Phoenix')).toBe(true);
    expect(isAgencyTimeZone('America/Los_Angeles')).toBe(true);
    expect(isAgencyTimeZone('Not/AZone')).toBe(false);
  });

  it('uses the selected zone hour across daylight-saving transitions', () => {
    expect(agencyHour(new Date('2026-01-05T15:00:00Z'), 'America/New_York')).toBe(10);
    expect(agencyHour(new Date('2026-07-06T16:00:00Z'), 'America/Los_Angeles')).toBe(9);
  });

  it('converts appointment inputs using the selected zone and rejects nonexistent local times', () => {
    const instant = '2026-07-06T16:30:00.000Z';
    expect(agencyDateTimeInput(instant, 'America/Los_Angeles')).toBe('2026-07-06T09:30');
    expect(agencyInputToIso('2026-07-06T09:30', 'America/Los_Angeles')).toBe(instant);
    expect(agencyInputToIso('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('finds local midnight using the correct seasonal UTC offset', () => {
    expect(startOfAgencyDay(new Date('2026-01-05T18:00:00Z'), 'America/New_York').toISOString())
      .toBe('2026-01-05T05:00:00.000Z');
    expect(startOfAgencyDay(new Date('2026-07-06T18:00:00Z'), 'America/New_York').toISOString())
      .toBe('2026-07-06T04:00:00.000Z');
    expect(endOfAgencyDay(new Date('2026-03-08T12:00:00Z'), 'America/New_York').toISOString())
      .toBe('2026-03-09T04:00:00.000Z');
    expect(endOfAgencyDay(new Date('2026-11-01T12:00:00Z'), 'America/New_York').toISOString())
      .toBe('2026-11-02T05:00:00.000Z');
  });

  it('schedules the next business morning in the selected zone', () => {
    expect(nextAgencyBusinessMorning(new Date('2026-01-02T18:00:00Z'), 'America/Denver').toISOString())
      .toBe('2026-01-05T15:00:00.000Z');
  });
});
