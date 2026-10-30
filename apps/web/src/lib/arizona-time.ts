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