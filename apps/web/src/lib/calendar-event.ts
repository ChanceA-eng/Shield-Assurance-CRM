import { agencyDateTimeInput, agencyInputToIso, DEFAULT_AGENCY_TIME_ZONE, type AgencyTimeZone } from './agency-time';

export function calendarDate(value = new Date(), timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): string {
  return agencyDateTimeInput(value, timeZone).slice(0, 10);
}

export function eventDueIso(date: string, time: string | null, allDay: boolean, timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): string | null {
  return agencyInputToIso(`${date}T${allDay ? '09:00' : (time ?? '').slice(0, 5)}`, timeZone);
}

export function validateCalendarChange(body: Record<string, unknown>, timeZone: AgencyTimeZone = DEFAULT_AGENCY_TIME_ZONE): string | null {
  const allowed = ['id', 'subject', 'title', 'description', 'event_date', 'event_time', 'all_day', 'status', 'related_type', 'related_id', 'client_id', 'expected_updated_at', 'meeting_type', 'duration_minutes', 'location', 'calendar_sync', 'expected_revision'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return 'Unknown event field.';
  for (const field of ['subject', 'title', 'description', 'event_date', 'event_time', 'related_type', 'related_id', 'client_id', 'expected_updated_at']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') return `Invalid ${field}.`;
  }
  if (body.all_day !== undefined && typeof body.all_day !== 'boolean') return 'Choose an all-day or timed event.';
  if (body.status !== undefined && !['scheduled', 'completed', 'cancelled'].includes(String(body.status))) return 'Choose scheduled, completed, or cancelled status.';
  if (body.meeting_type !== undefined && !['phone', 'in_person', 'google_meet', 'zoom'].includes(String(body.meeting_type))) return 'Choose phone, in person, Google Meet, or Zoom.';
  if (body.duration_minutes !== undefined && (typeof body.duration_minutes !== 'number' || !Number.isInteger(body.duration_minutes) || body.duration_minutes < 15 || body.duration_minutes > 120)) return 'Choose an appointment duration between 15 and 120 minutes.';
  if (body.location !== undefined && body.location !== null && (typeof body.location !== 'string' || body.location.length > 1000)) return 'Enter a phone number or address of at most 1,000 characters.';
  if (body.calendar_sync !== undefined && typeof body.calendar_sync !== 'boolean') return 'Choose whether to sync this appointment to Calendar.';
  if (body.expected_revision !== undefined && (typeof body.expected_revision !== 'number' || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0)) return 'Choose a valid appointment revision.';
  if (typeof body.subject === 'string' && (!body.subject.trim() || body.subject.length > 240)) return 'Enter an event title of at most 240 characters.';
  if (typeof body.title === 'string' && (!body.title.trim() || body.title.length > 240)) return 'Enter an event title of at most 240 characters.';
  if (typeof body.event_date === 'string' && !eventDueIso(body.event_date, '09:00', true, timeZone)) return 'Choose a valid event date.';
  if (body.event_time && (typeof body.event_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(body.event_time))) return 'Choose a valid event time.';
  if (typeof body.event_date === 'string' && typeof body.event_time === 'string' && body.all_day !== true
    && !eventDueIso(body.event_date, body.event_time, false, timeZone)) return 'Choose a valid local appointment time.';
  return null;
}
