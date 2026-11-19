import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeAgencyMember } from './agency-membership';
import { eventDueIso } from './calendar-event';
import { getAgencyTimeZone } from './automation-settings';
import { calendarBusy, calendarRequest, CalendarHttpError } from './google-calendar';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';
import type { AgencyTimeZone } from './agency-time';
import { ownZoomConnection } from './zoom-provider';
import { syncZoomMeeting } from './zoom-appointments';

export interface Appointment {
  id: string; user_id: string; subject: string; description: string | null;
  event_date: string; event_time: string | null; all_day: boolean;
  status: 'scheduled' | 'completed' | 'cancelled';
  related_type: string | null; related_id: string | null; client_id: string | null;
  meeting_type: 'phone' | 'in_person' | 'google_meet' | 'zoom'; duration_minutes: number; location: string | null;
  zoom_meeting_id?: string | null; zoom_join_url?: string | null; zoom_create_attempted_at?: string | null; zoom_subject?: string | null;
  calendar_sync: boolean; google_event_id: string | null; google_event_url: string | null;
  google_meet_url: string | null; sync_status: 'not_required' | 'pending' | 'synced' | 'failed';
  sync_error: string | null; revision: number; time_zone: AgencyTimeZone; updated_at: string;
}
export function publicAppointment(row: Appointment): Omit<Appointment, 'description' | 'user_id' | 'related_type' | 'related_id' | 'client_id' | 'google_event_id' | 'calendar_sync' | 'updated_at' | 'zoom_meeting_id' | 'zoom_create_attempted_at' | 'zoom_subject'> {
  return {
    id: row.id, subject: row.subject, event_date: row.event_date, event_time: row.event_time, all_day: row.all_day,
    status: row.status, meeting_type: row.meeting_type, duration_minutes: row.duration_minutes,
    location: row.location, google_meet_url: row.google_meet_url, google_event_url: row.google_event_url,
    zoom_join_url: row.zoom_join_url ?? null,
    sync_status: row.sync_status, sync_error: row.sync_status === 'failed' ? 'Calendar update needs an agency retry.' : row.sync_status === 'pending' ? 'Calendar is preparing the appointment. Retry shortly.' : null,
    revision: row.revision, time_zone: row.time_zone,
  };
}
export function safeAppointment(row: Appointment & { sync_lock?: unknown; sync_lease_until?: unknown }): Appointment {
  const { sync_lock: _lock, sync_lease_until: _lease, ...safe } = row;
  return safe;
}
export async function ownedAppointment(db: SupabaseClient, actor: string, id: string): Promise<Appointment> {
  if (!isUuid(id)) throw new WorkspaceError('Choose a valid appointment.', 400);
  await activeAgencyMember(db, actor);
  const result = await db.from('events').select('*').eq('id', id).eq('user_id', actor).maybeSingle<Appointment>();
  if (result.error) throw databaseError(result.error);
  if (!result.data) throw new WorkspaceError('Appointment not found or owned by another agent.', 404);
  return safeAppointment(result.data);
}
export async function assertAppointmentTaskAccess(
  db: SupabaseClient, actor: string,
  task: { event_id?: string | null; related_type?: string | null; related_id?: string | null },
  changes: Record<string, unknown>,
): Promise<void> {
  const eventId = task.event_id ?? (task.related_type === 'event' ? task.related_id : null);
  if (!eventId) return;
  const event = await ownedAppointment(db, actor, eventId);
  if (event.status === 'cancelled' && changes.status !== undefined && changes.status !== 'cancelled') {
    throw new WorkspaceError('Cancelled appointments remain in history. Create a new appointment from Calendar.', 409);
  }
  if ((event.google_event_id || event.calendar_sync || event.meeting_type === 'google_meet' || event.meeting_type === 'zoom' || event.zoom_meeting_id || event.zoom_create_attempted_at)
    && (changes.due_date !== undefined || changes.status !== undefined)) {
    throw new WorkspaceError('Change this appointment from Calendar so its meeting and calendar stay synchronized.', 409);
  }
}
export function appointmentWindow(row: Pick<Appointment, 'event_date' | 'event_time' | 'all_day' | 'duration_minutes' | 'time_zone'>): { start: string; end: string } {
  const start = eventDueIso(row.event_date, row.event_time, row.all_day, row.time_zone);
  if (!start) throw new WorkspaceError('Choose a valid appointment date and local time.', 400);
  return { start, end: new Date(Date.parse(start) + row.duration_minutes * 60000).toISOString() };
}
export async function checkAppointmentAvailability(db: SupabaseClient, actor: string, row: Appointment): Promise<void> {
  if (row.status !== 'scheduled' || (!row.calendar_sync && row.meeting_type !== 'google_meet')) return;
  if (row.all_day) throw new WorkspaceError('Choose a timed appointment for Calendar or Google Meet.', 400);
  const window = appointmentWindow(row);
  if ((await calendarBusy(db, actor, window.start, window.end, row.google_event_id ?? undefined)).length) {
    throw new WorkspaceError('This time conflicts with Google Calendar. Choose another appointment time.', 409);
  }
}
export async function prepareAppointmentChange(db: SupabaseClient, actor: string, id: string, changes: Record<string, unknown>, create: boolean, agencyZone?: AgencyTimeZone): Promise<Appointment> {
  const previous = create ? null : await ownedAppointment(db, actor, id);
  if (create) await activeAgencyMember(db, actor);
  const timeZone = previous?.time_zone ?? agencyZone ?? await getAgencyTimeZone(db);
  const candidate = {
    meeting_type: 'phone', duration_minutes: 30, calendar_sync: false, status: 'scheduled', all_day: false,
    ...previous, ...changes, id, user_id: actor, time_zone: timeZone,
  } as Appointment;
  // Availability is checked before persistence, and checked again under a
  // durable per-owner sync lease immediately before remote creation/update.
  const moving = create || !previous || ['event_date', 'event_time', 'duration_minutes', 'meeting_type', 'calendar_sync', 'all_day'].some((key) => changes[key] !== undefined && changes[key] !== previous[key as keyof Appointment]);
  if (candidate.meeting_type === 'zoom' && candidate.all_day) throw new WorkspaceError('Choose a timed appointment for Zoom.', 400);
  if (moving && candidate.meeting_type === 'zoom' && candidate.status === 'scheduled'
    && (await ownZoomConnection(db, actor))?.status !== 'connected') {
    throw new WorkspaceError('Connect your Zoom account before booking Zoom appointments.', 409);
  }
  if (moving) await checkAppointmentAvailability(db, actor, candidate);
  return candidate;
}
function meetUrl(result: Record<string, unknown>): string | null {
  const conference = isRecord(result.conferenceData) ? result.conferenceData : {};
  const entries = Array.isArray(conference.entryPoints) ? conference.entryPoints : [];
  const value = typeof result.hangoutLink === 'string' ? result.hangoutLink
    : entries.find((entry) => isRecord(entry) && entry.entryPointType === 'video' && typeof entry.uri === 'string')?.uri;
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'meet.google.com' ? url.href : null; }
  catch { return null; }
}
async function providerEvent(db: SupabaseClient, actor: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await calendarRequest(db, actor, path);
    if (!isRecord(result)) throw new WorkspaceError('Google Calendar returned an incomplete appointment. Retry sync.', 503);
    return result;
  } catch (error) {
    if (error instanceof CalendarHttpError && [404, 410].includes(error.providerStatus)) return null;
    throw error;
  }
}
export async function syncAppointment(db: SupabaseClient, actor: string, id: string, zoomRecovery?: { confirmedMissing: true; revision: number }): Promise<Appointment> {
  const lock = randomUUID();
  const claimed = await db.rpc('claim_appointment_sync', { p_id: id, p_user: actor, p_lock: lock });
  if (claimed.error) throw databaseError(claimed.error);
  let event = claimed.data as Appointment;
  if (event.sync_status === 'not_required') return safeAppointment(event);
  let patch: Record<string, unknown>;
  try {
    const zoom = event.meeting_type === 'zoom' || event.zoom_meeting_id || event.zoom_create_attempted_at
      ? await syncZoomMeeting(db, event, lock, zoomRecovery) : {};
    // Persist the Zoom identity before Google sync so a later provider failure
    // never loses the meeting needed for retry or cancellation.
    if (Object.keys(zoom).length) {
      const saved = await db.from('events').update(zoom).eq('id', id).eq('user_id', actor).eq('revision', event.revision)
        .eq('sync_lock', lock).gt('sync_lease_until', new Date().toISOString()).select('*').maybeSingle<Appointment>();
      if (saved.error) throw databaseError(saved.error);
      if (!saved.data) throw new WorkspaceError('Meeting sync lost its lease. Refresh and retry sync.', 409);
      event = saved.data;
    }
    if (!event.google_event_id && !event.calendar_sync && event.meeting_type !== 'google_meet') {
      patch = { sync_status: event.status === 'cancelled' || event.meeting_type === 'zoom' ? 'synced' : 'not_required', sync_error: null };
    } else {
    const path = `/calendars/primary/events/${encodeURIComponent(event.google_event_id!)}`;
    let remote = await providerEvent(db, actor, path);
    const remove = event.status === 'cancelled' || (!event.calendar_sync && event.meeting_type !== 'google_meet');
    if (remove) {
      if (remote && remote.status !== 'cancelled') {
        try { await calendarRequest(db, actor, `${path}?sendUpdates=none`, { method: 'DELETE' }); }
        catch (error) { if (!(error instanceof CalendarHttpError && [404, 410].includes(error.providerStatus))) throw error; }
      }
      patch = {
        sync_status: event.status === 'cancelled' || event.meeting_type === 'zoom' ? 'synced' : 'not_required', sync_error: null,
        google_meet_url: null, google_event_url: null, ...(event.status !== 'cancelled' ? { google_event_id: null } : {}),
      };
    } else {
      if (remote?.status === 'cancelled') throw new WorkspaceError('This Google Calendar event was deleted outside the CRM. Cancel this appointment and create a new one.', 409);
      if (event.sync_status === 'synced' && remote && (event.meeting_type !== 'google_meet' || meetUrl(remote))) {
        patch = { sync_status: 'synced', sync_error: null, google_meet_url: event.meeting_type === 'google_meet' ? meetUrl(remote) : null };
      } else {
        await checkAppointmentAvailability(db, actor, event);
        const { start, end } = appointmentWindow(event);
        const conference = isRecord(remote?.conferenceData) ? remote.conferenceData : {};
        const priorRequest = isRecord(conference.createRequest) ? conference.createRequest : {};
        const conferenceFailed = isRecord(priorRequest.status) && priorRequest.status.statusCode === 'failure';
        const requestId = createHash('sha256').update(conferenceFailed && typeof priorRequest.requestId === 'string'
          ? `${priorRequest.requestId}:retry` : event.google_event_id!).digest('hex');
        const body = {
          summary: event.subject, description: event.description ?? '', location: event.meeting_type === 'zoom' ? event.zoom_join_url ?? '' : event.location ?? '',
          start: { dateTime: start, timeZone: event.time_zone }, end: { dateTime: end, timeZone: event.time_zone },
          extendedProperties: { private: { crmEventId: event.id, crmRevision: String(event.revision) } },
          ...(event.meeting_type === 'google_meet'
            ? !remote?.conferenceData || conferenceFailed ? { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}
            : { conferenceData: null }),
        };
        const revision = isRecord(remote?.extendedProperties) && isRecord(remote.extendedProperties.private) ? remote.extendedProperties.private.crmRevision : undefined;
        if (!remote || revision !== String(event.revision) || conferenceFailed) {
          try {
            const result = await calendarRequest(db, actor, remote ? `${path}?conferenceDataVersion=1&sendUpdates=none` : '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none', {
              method: remote ? 'PATCH' : 'POST', body: JSON.stringify(remote ? body : { id: event.google_event_id, ...body }),
            });
            if (!isRecord(result)) throw new WorkspaceError('Google returned an incomplete appointment. Retry sync.', 503);
            remote = result;
          } catch (error) {
            if (!(error instanceof CalendarHttpError && error.providerStatus === 409)) throw error;
            remote = await providerEvent(db, actor, path);
            if (!remote) throw new WorkspaceError('Calendar creation is still being reconciled. Retry sync.', 503);
          }
        }
        const join = remote ? meetUrl(remote) : null;
        const responseConference = remote && isRecord(remote.conferenceData) ? remote.conferenceData : {};
        const create = isRecord(responseConference.createRequest) ? responseConference.createRequest : {};
        const state = isRecord(create.status) ? create.status.statusCode : null;
        patch = {
          google_event_url: typeof remote?.htmlLink === 'string' ? remote.htmlLink : null,
          google_meet_url: event.meeting_type === 'google_meet' ? join : null,
          sync_status: event.meeting_type !== 'google_meet' || join ? 'synced' : state === 'failure' ? 'failed' : 'pending',
          sync_error: event.meeting_type !== 'google_meet' || join ? null : state === 'failure'
            ? 'Google could not create the Meet conference. Retry calendar sync.' : 'Google is preparing the Meet link. Retry sync before sending confirmation.',
        };
      }
    }
    }
  } catch (error) {
    patch = { sync_status: 'failed', sync_error: error instanceof WorkspaceError ? error.message : 'Meeting or calendar sync is unavailable. The appointment is saved; retry calendar sync.' };
  }
  const saved = await db.from('events').update({ ...patch, sync_lock: null, sync_lease_until: null })
    .eq('id', id).eq('user_id', actor).eq('revision', event.revision).eq('sync_lock', lock)
    .gt('sync_lease_until', new Date().toISOString()).select('*').maybeSingle<Appointment>();
  if (saved.error) throw databaseError(saved.error);
  if (!saved.data) throw new WorkspaceError('Calendar sync lost its lease. The appointment is saved; refresh and retry sync.', 409);
  event = saved.data;
  return safeAppointment(event);
}
