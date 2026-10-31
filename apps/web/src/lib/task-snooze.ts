import { arizonaDateTimeInput, arizonaInputToIso, startOfArizonaDay } from './arizona-time';

export type SnoozePreset = 'later' | 'tomorrow' | 'nextweek';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Preset snooze targets in Arizona time: +3h, tomorrow 9 AM, next Monday 9 AM. */
export function snoozePresetIso(option: SnoozePreset, now = new Date()): string {
  if (option === 'later') return new Date(now.getTime() + 3 * HOUR_MS).toISOString();
  const dayStart = startOfArizonaDay(now).getTime();
  if (option === 'tomorrow') return new Date(dayStart + DAY_MS + 9 * HOUR_MS).toISOString();
  const weekday = new Date(dayStart - 7 * HOUR_MS).getUTCDay();
  const daysToMonday = ((8 - weekday) % 7) || 7;
  return new Date(dayStart + daysToMonday * DAY_MS + 9 * HOUR_MS).toISOString();
}

/** Default value for the custom picker: tomorrow at 9 AM Arizona. */
export function defaultSnoozeInput(now = new Date()): string {
  return arizonaDateTimeInput(snoozePresetIso('tomorrow', now));
}

/** Validates an Arizona datetime-local value; must be in the future. */
export function customSnoozeIso(value: string, now = new Date()): { iso: string } | { error: string } {
  const iso = arizonaInputToIso(value);
  if (!iso) return { error: 'Choose a valid date and time.' };
  if (Date.parse(iso) <= now.getTime()) return { error: 'Pick a time in the future.' };
  return { iso };
}
