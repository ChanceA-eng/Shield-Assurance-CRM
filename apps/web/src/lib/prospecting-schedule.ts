import { addAgencyDays, agencyInputToIso, DEFAULT_AGENCY_TIME_ZONE } from './agency-time';

export const PROSPECTING_TOUCHES = [
  { day: 1, channel: 'call' },
  { day: 2, channel: 'email' },
  { day: 4, channel: 'call' },
  { day: 7, channel: 'email' },
  { day: 9, channel: 'call' },
  { day: 12, channel: 'email' },
  { day: 16, channel: 'email' },
  { day: 21, channel: 'call' },
] as const;

export function prospectingSchedule(now: Date, timeZone = DEFAULT_AGENCY_TIME_ZONE): Array<{
  touch_number: number; channel: 'call' | 'email'; due_at: string;
}> {
  return PROSPECTING_TOUCHES.map((touch, index) => {
    const date = addAgencyDays(now, touch.day - 1, timeZone);
    const morning = agencyInputToIso(`${date}T09:00`, timeZone);
    if (!morning) throw new Error('The prospecting schedule could not be calculated in the agency time zone.');
    return {
      touch_number: index + 1,
      channel: touch.channel,
      due_at: index === 0 && Date.parse(morning) < now.getTime() ? now.toISOString() : morning,
    };
  });
}
