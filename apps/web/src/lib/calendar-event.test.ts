import { describe, expect, it } from 'vitest';
import { calendarDate, eventDueIso, validateCalendarChange } from './calendar-event';

describe('agency calendar contracts', () => {
  it('keeps midnight dates and timed tasks in Arizona', () => {
    expect(calendarDate(new Date('2026-11-02T02:00:00Z'))).toBe('2026-11-01');
    expect(eventDueIso('2026-11-02', '14:15', false)).toBe('2026-11-02T21:15:00.000Z');
    expect(eventDueIso('2026-11-02', null, true)).toBe('2026-11-02T16:00:00.000Z');
    expect(eventDueIso('2026-02-30', '09:00', false)).toBeNull();
    expect(calendarDate(new Date('2026-01-01T02:00:00Z'), 'America/New_York')).toBe('2025-12-31');
    expect(eventDueIso('2026-07-06', '09:00', false, 'America/Los_Angeles')).toBe('2026-07-06T16:00:00.000Z');
    expect(eventDueIso('2026-03-08', '02:30', false, 'America/New_York')).toBeNull();
  });
  it('rejects malformed fields rather than defaulting to success', () => {
    expect(validateCalendarChange({ event_date: '2026-02-30' })).toBeTruthy();
    expect(validateCalendarChange({ event_time: '25:15' })).toBeTruthy();
    expect(validateCalendarChange({ status: 'bogus' })).toBeTruthy();
    expect(validateCalendarChange({ title: 'Call', event_date: '2026-11-02', event_time: '14:15', all_day: false })).toBeNull();
  });
});
