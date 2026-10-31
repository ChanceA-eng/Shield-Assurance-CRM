import { describe, expect, it } from 'vitest';
import { arizonaDateTimeInput, arizonaInputToIso, endOfArizonaDay, isArizonaWeekend, nextArizonaBusinessMorning, startOfArizonaDay } from './arizona-time';

describe('Arizona business time', () => {
  it('uses the Arizona calendar date near the UTC boundary', () => {
    const fridayNight = new Date('2026-08-29T03:00:00.000Z');

    expect(isArizonaWeekend(fridayNight)).toBe(false);
    expect(startOfArizonaDay(fridayNight).toISOString()).toBe('2026-08-28T07:00:00.000Z');
  });

  it('schedules the next intake follow-up for Monday at 8 AM Arizona time', () => {
    const fridayMorning = new Date('2026-08-28T16:00:00.000Z');

    expect(nextArizonaBusinessMorning(fridayMorning, true).toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });

  it('uses today at 8 AM when the Arizona workday has not started', () => {
    const mondayEarlyMorning = new Date('2026-08-31T13:30:00.000Z');

    expect(nextArizonaBusinessMorning(mondayEarlyMorning).toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });
  it('round-trips reminder inputs independently of the computer timezone', () => {
    expect(arizonaInputToIso('2026-10-31T09:30')).toBe('2026-10-31T16:30:00.000Z');
    expect(arizonaDateTimeInput('2026-10-31T16:30:00.000Z')).toBe('2026-10-31T09:30');
  });
  it('rejects impossible calendar dates rather than shifting a reminder', () => {
    expect(arizonaInputToIso('2026-02-30T09:30')).toBeNull();
    expect(arizonaInputToIso('2026-10-31T24:00')).toBeNull();
  });
  it('uses the exclusive Arizona end-of-day boundary', () => {
    expect(endOfArizonaDay(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });
});