import { arizonaDateTimeInput, arizonaInputToIso } from './arizona-time';

export function calendarDate(value = new Date()): string {
  return arizonaDateTimeInput(value).slice(0, 10);
}

export function eventDueIso(date: string, time: string | null, allDay: boolean): string | null {
  return arizonaInputToIso(`${date}T${allDay ? '09:00' : (time ?? '').slice(0, 5)}`);
}

export function validateCalendarChange(body: Record<string, unknown>): string | null {
  const allowed = ['id', 'subject', 'title', 'description', 'event_date', 'event_time', 'all_day', 'status', 'related_type', 'related_id', 'client_id', 'expected_updated_at'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return 'Unknown event field.';
  for (const field of ['subject', 'title', 'description', 'event_date', 'event_time', 'related_type', 'related_id', 'client_id', 'expected_updated_at']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') return `Invalid ${field}.`;
  }
  if (body.all_day !== undefined && typeof body.all_day !== 'boolean') return 'Choose an all-day or timed event.';
  if (body.status !== undefined && body.status !== 'scheduled' && body.status !== 'completed') return 'Choose scheduled or completed status.';
  if (typeof body.subject === 'string' && (!body.subject.trim() || body.subject.length > 240)) return 'Enter an event title of at most 240 characters.';
  if (typeof body.title === 'string' && (!body.title.trim() || body.title.length > 240)) return 'Enter an event title of at most 240 characters.';
  if (typeof body.event_date === 'string' && !eventDueIso(body.event_date, '09:00', true)) return 'Choose a valid event date.';
  if (body.event_time && (typeof body.event_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(body.event_time))) return 'Choose a valid event time.';
  return null;
}
