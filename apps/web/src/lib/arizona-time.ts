const ARIZONA_UTC_OFFSET_HOURS = 7;
const HOUR_MS = 60 * 60 * 1000;

function arizonaLocalDate(now: Date): Date {
  return new Date(now.getTime() - ARIZONA_UTC_OFFSET_HOURS * HOUR_MS);
}

function isWeekend(day: number): boolean {
  return day === 0 || day === 6;
}

function arizonaLocalToUtc(localDate: Date, hour: number): Date {
  return new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    hour + ARIZONA_UTC_OFFSET_HOURS,
  ));
}

export function isArizonaWeekend(now: Date): boolean {
  return isWeekend(arizonaLocalDate(now).getUTCDay());
}

export function startOfArizonaDay(now: Date): Date {
  return arizonaLocalToUtc(arizonaLocalDate(now), 0);
}

export function endOfArizonaDay(now: Date): Date {
  return new Date(startOfArizonaDay(now).getTime() + 24 * HOUR_MS);
}

export function arizonaDateTimeInput(value: string | Date): string {
  const parsed = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(parsed.getTime())) return '';
  return arizonaLocalDate(parsed).toISOString().slice(0, 16);
}

export function arizonaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00-07:00`);
  if (!Number.isFinite(parsed.getTime()) || arizonaDateTimeInput(parsed) !== value) return null;
  return parsed.toISOString();
}

export function formatArizonaDateTime(value?: string | null): string {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

export function nextArizonaBusinessMorning(now: Date, startTomorrow = false): Date {
  const localTarget = arizonaLocalDate(now);

  if (startTomorrow) {
    localTarget.setUTCDate(localTarget.getUTCDate() + 1);
  }

  let target = arizonaLocalToUtc(localTarget, 8);
  if (!startTomorrow && target <= now) {
    localTarget.setUTCDate(localTarget.getUTCDate() + 1);
    target = arizonaLocalToUtc(localTarget, 8);
  }

  while (isWeekend(localTarget.getUTCDay())) {
    localTarget.setUTCDate(localTarget.getUTCDate() + 1);
    target = arizonaLocalToUtc(localTarget, 8);
  }

  return target;
}