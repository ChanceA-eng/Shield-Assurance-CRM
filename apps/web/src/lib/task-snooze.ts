import { addAgencyDays, agencyDateTimeInput, agencyInputToIso, DEFAULT_AGENCY_TIME_ZONE, type AgencyTimeZone } from './agency-time';

export type SnoozePreset = 'later' | 'tomorrow' | 'nextweek';

const HOUR_MS = 60 * 60 * 1000;

function requireAgencyTime(value: string, timeZone: AgencyTimeZone): string {
  const iso = agencyInputToIso(value, timeZone);
  if (!iso) throw new Error('The requested agency snooze time could not be calculated.');
  return iso;
}

/** Preset snooze targets in agency time: +3h, tomorrow 9 AM, next Monday 9 AM. */
export function snoozePresetIso(option: SnoozePreset, now = new Date(), timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): string {
  if (option === 'later') return new Date(now.getTime() + 3 * HOUR_MS).toISOString();
  const localDate = agencyDateTimeInput(now, timeZone).slice(0, 10);
  if (option === 'tomorrow') return requireAgencyTime(`${addAgencyDays(localDate, 1, timeZone)}T09:00`, timeZone);
  const [, month, day] = localDate.split('-').map(Number);
  const year = Number(localDate.slice(0, 4));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysToMonday = ((8 - weekday) % 7) || 7;
  return requireAgencyTime(`${addAgencyDays(localDate, daysToMonday, timeZone)}T09:00`, timeZone);
}

/** Default value for the custom picker: tomorrow at 9 AM agency time. */
export function defaultSnoozeInput(now = new Date(), timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): string {
  return agencyDateTimeInput(snoozePresetIso('tomorrow', now, timeZone), timeZone);
}

/** Validates an agency-local datetime value; must be in the future. */
export function customSnoozeIso(value: string, now = new Date(), timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): { iso: string } | { error: string } {
  const iso = agencyInputToIso(value, timeZone);
  if (!iso) return { error: 'Choose a valid date and time.' };
  if (Date.parse(iso) <= now.getTime()) return { error: 'Pick a time in the future.' };
  return { iso };
}
