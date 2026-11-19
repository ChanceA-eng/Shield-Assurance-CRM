export const DEFAULT_AGENCY_TIME_ZONE = 'America/Phoenix';

export const SUPPORTED_AGENCY_TIME_ZONES = [
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

export type AgencyTimeZone = (typeof SUPPORTED_AGENCY_TIME_ZONES)[number];

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function isAgencyTimeZone(value: unknown): value is AgencyTimeZone {
  return typeof value === 'string' && SUPPORTED_AGENCY_TIME_ZONES.includes(value as AgencyTimeZone);
}

function localParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: weekdays.indexOf(value('weekday')),
  };
}

function localDateTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string, minute = 0): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = localParts(new Date(timestamp), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const difference = target - represented;
    if (difference === 0) return new Date(timestamp);
    timestamp += difference;
  }
  const result = new Date(timestamp);
  const local = localParts(result, timeZone);
  if (local.year !== year || local.month !== month || local.day !== day || local.hour !== hour || local.minute !== minute) {
    throw new Error('The requested agency local time does not exist.');
  }
  return result;
}

export function agencyHour(date: Date, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): number {
  return localParts(date, timeZone).hour;
}

export function agencyDateTimeInput(value: string | Date, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): string {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(parsed.getTime())) return '';
  const local = localParts(parsed, timeZone);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
}

export function addAgencyDays(value: Date | string, days: number, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): string {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value : agencyDateTimeInput(value, timeZone).slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function agencyInputToIso(value: string, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  try {
    const result = localDateTimeToUtc(year, month, day, hour, timeZone, minute);
    return agencyDateTimeInput(result, timeZone) === value ? result.toISOString() : null;
  } catch {
    return null;
  }
}

export function formatAgencyDateTime(value: string | Date | null | undefined, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): string {
  if (!value) return 'Not scheduled';
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(parsed.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(parsed);
}

export function startOfAgencyDay(date: Date, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): Date {
  const local = localParts(date, timeZone);
  return localDateTimeToUtc(local.year, local.month, local.day, 0, timeZone);
}

export function endOfAgencyDay(date: Date, timeZone: string = DEFAULT_AGENCY_TIME_ZONE): Date {
  const local = localParts(date, timeZone);
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return localDateTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, timeZone);
}

export function nextAgencyBusinessMorning(
  now: Date,
  timeZone: string = DEFAULT_AGENCY_TIME_ZONE,
  startTomorrow = false,
): Date {
  const local = localParts(now, timeZone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (startTomorrow || localDateTimeToUtc(local.year, local.month, local.day, 8, timeZone) <= now) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return localDateTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 8, timeZone);
}
