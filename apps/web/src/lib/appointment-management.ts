import type { SupabaseClient } from '@supabase/supabase-js';
import { calendarBusy, calendarStateHash, ownCalendarConnection } from './google-calendar';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { activeAgencyMember } from './agency-membership';
import { appointmentWindow, ownedAppointment, prepareAppointmentChange, syncAppointment, type Appointment } from './appointment-lifecycle';
import { validateCalendarChange } from './calendar-event';
import { sendAppointmentNotification } from './appointment-notifications';

export async function managedAppointment(db: SupabaseClient, token: string): Promise<Appointment> {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new WorkspaceError('This appointment link is invalid or expired.', 404);
  const found = await db.from('appointment_manage_tokens').select('event_id').eq('token_hash', calendarStateHash(token))
    .gt('expires_at', new Date().toISOString()).maybeSingle<{ event_id: string }>();
  if (found.error) throw databaseError(found.error);
  if (!found.data) throw new WorkspaceError('This appointment link is invalid or expired.', 404);
  const event = await db.from('events').select('*').eq('id', found.data.event_id).maybeSingle<Appointment>();
  if (event.error) throw databaseError(event.error);
  if (!event.data) throw new WorkspaceError('This appointment is unavailable.', 404);
  // The token never bypasses agency deactivation or changes event ownership.
  await activeAgencyMember(db, event.data.user_id);
  return event.data;
}
export async function manageAppointment(
  db: SupabaseClient, event: Appointment, body: Record<string, unknown>,
): Promise<{ event: Appointment; notification: { status: 'sent' | 'failed' | 'not_requested'; error?: string } }> {
  if (Object.keys(body).some((key) => !['action', 'event_date', 'event_time', 'revision'].includes(key))
    || !['cancel', 'reschedule'].includes(String(body.action))) throw new WorkspaceError('Choose cancellation or rescheduling only.', 400);
  if (event.status === 'cancelled' && body.action === 'cancel') {
    return { event, notification: { status: 'not_requested' } };
  }
  if (event.status !== 'scheduled') throw new WorkspaceError('This appointment is no longer scheduled. Contact your agent to book another.', 409);
  if (!Number.isSafeInteger(body.revision) || body.revision !== event.revision) throw new WorkspaceError('This appointment changed. Refresh its details first.', 409);
  let changes: Record<string, unknown> = { status: 'cancelled', expected_revision: event.revision };
  if (body.action === 'reschedule') {
    if (typeof body.event_date !== 'string' || typeof body.event_time !== 'string' || event.all_day) throw new WorkspaceError('Choose a new date and time for this timed appointment.', 400);
    changes = { event_date: body.event_date, event_time: body.event_time, expected_revision: event.revision };
    const invalid = validateCalendarChange(changes, event.time_zone);
    if (invalid) throw new WorkspaceError(invalid, 400);
    const candidate = { ...event, event_date: body.event_date, event_time: body.event_time };
    const { start } = appointmentWindow(candidate);
    if (Date.parse(start) < Date.now() + 30 * 60000 || Date.parse(start) > Date.now() + 90 * 86400000) {
      throw new WorkspaceError('Choose a time at least 30 minutes from now and within 90 days. Contact your agent for other dates.', 400);
    }
    if (Date.parse(appointmentWindow(event).start) <= Date.now()) throw new WorkspaceError('Contact your agent to change a past appointment.', 409);
    // The customer cannot change the duration, owner, contact, meeting type,
    // location, or calendar choice encoded in the agency-created appointment.
    await prepareAppointmentChange(db, event.user_id, event.id, changes, false);
    if (!event.calendar_sync && event.meeting_type !== 'google_meet' && (await ownCalendarConnection(db, event.user_id))?.status === 'connected') {
      const { start: from, end } = appointmentWindow(candidate);
      if ((await calendarBusy(db, event.user_id, from, end, event.google_event_id ?? undefined)).length) {
        throw new WorkspaceError('This time is unavailable. Choose another appointment time.', 409);
      }
    }
  }
  const result = await db.rpc('save_calendar_event', {
    p_id: event.id, p_changes: changes, p_create: false, p_user: event.user_id, p_actor: 'Customer appointment management',
  });
  if (result.error) throw databaseError(result.error);
  let saved = result.data as Appointment;
  if (saved.sync_status !== 'not_required') {
    try { saved = await syncAppointment(db, saved.user_id, saved.id); }
    catch {
      saved = await ownedAppointment(db, saved.user_id, saved.id);
    }
  }
  let notification: { status: 'sent' | 'failed' | 'not_requested'; error?: string } = { status: 'not_requested' };
  const conversation = saved.related_type === 'lead' && saved.related_id ? `lead:${saved.related_id}`
    : saved.client_id ? `client:${saved.client_id}` : saved.related_type === 'client' && saved.related_id ? `client:${saved.related_id}` : null;
  if (conversation) {
    try {
      await sendAppointmentNotification(db, saved.user_id, saved.id, conversation);
      notification = { status: 'sent' };
    } catch (error) {
      notification = { status: 'failed', error: error instanceof WorkspaceError ? error.message : 'Appointment updated, but email notification is unavailable. Contact your agent.' };
    }
  }
  return { event: saved, notification };
}
