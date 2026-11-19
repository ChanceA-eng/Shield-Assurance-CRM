import { describe, expect, it } from 'vitest';
import { prospectingSchedule } from './prospecting-schedule';

describe('agent-led prospecting schedule', () => {
  it('schedules the handbook days in local time across daylight saving', () => {
    const touches = prospectingSchedule(new Date('2026-10-30T12:00:00Z'), 'America/New_York');
    expect(touches.map((touch) => [touch.channel, touch.due_at])).toEqual([
      ['call', '2026-10-30T13:00:00.000Z'],
      ['email', '2026-10-31T13:00:00.000Z'],
      ['call', '2026-11-02T14:00:00.000Z'],
      ['email', '2026-11-05T14:00:00.000Z'],
      ['call', '2026-11-07T14:00:00.000Z'],
      ['email', '2026-11-10T14:00:00.000Z'],
      ['email', '2026-11-14T14:00:00.000Z'],
      ['call', '2026-11-19T14:00:00.000Z'],
    ]);
  });
  it('makes the first manual call due now when starting after the morning', () => {
    const now = new Date('2026-11-13T23:30:00Z');
    const touches = prospectingSchedule(now);
    expect(touches[0].due_at).toBe(now.toISOString());
    expect(touches[1].due_at).toBe('2026-11-14T16:00:00.000Z');
    expect(touches[7].due_at).toBe('2026-12-03T16:00:00.000Z');
  });
});
