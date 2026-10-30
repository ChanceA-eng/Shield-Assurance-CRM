import { describe, expect, it } from 'vitest';
import { isArizonaWeekend, nextArizonaBusinessMorning, startOfArizonaDay } from './arizona-time';

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
});