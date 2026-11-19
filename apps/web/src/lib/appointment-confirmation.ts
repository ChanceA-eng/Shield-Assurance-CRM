import type { SupabaseClient } from '@supabase/supabase-js';
import { parseConversationKey } from './conversations';
import { salesFacts } from './sales-templates';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { getAgencyTimeZone } from './automation-settings';
import { eventDueIso, calendarDate } from './calendar-event';
import { formatAgencyDateTime, type AgencyTimeZone } from './agency-time';
import { isUuid } from './workspace-validation';

export interface SavedAppointment {
  id: string; subject: string; event_date: string; event_time: string | null; all_day: boolean;
  related_type: string | null; related_id: string | null; client_id: string | null; status: string;
  meeting_type?: 'phone' | 'in_person' | 'google_meet' | 'zoom'; duration_minutes?: number; location?: string | null;
  zoom_join_url?: string | null;
  google_meet_url?: string | null; sync_status?: string; time_zone?: AgencyTimeZone;
}
export function appointmentDetails(row: SavedAppointment, timeZone: AgencyTimeZone): string {
  const due = eventDueIso(row.event_date, row.event_time, row.all_day, timeZone);
  if (!due) throw new WorkspaceError('This appointment has an invalid date or time. Correct it in the calendar.', 409);
  const meeting = row.meeting_type === 'google_meet' ? `Google Meet${row.google_meet_url ? `\nJoin: ${row.google_meet_url}` : ''}`
    : row.meeting_type === 'zoom' ? `Zoom${row.zoom_join_url ? `\nJoin: ${row.zoom_join_url}` : ''}`
    : row.meeting_type === 'in_person' ? 'In person' : 'Phone';
  return `${row.subject} — ${row.all_day ? `${row.event_date} (all day)` : formatAgencyDateTime(due, timeZone)} · ${timeZone}`
    + `\nDuration: ${row.duration_minutes ?? 30} minutes\n${meeting}${row.location ? `\n${row.location}` : ''}`;
}
export async function conversationAppointments(db: SupabaseClient, actor: string, conversation: string, appointmentId?: string) {
  const facts = await salesFacts(db, actor, conversation);
  const ref = parseConversationKey(conversation);
  if (!ref || ref.kind === 'unmatched') throw new WorkspaceError('Link a lead or account before choosing an appointment.', 409);
  if (appointmentId && !isUuid(appointmentId)) throw new WorkspaceError('Choose a saved appointment.', 400);
  const timeZone = await getAgencyTimeZone(db);
  const rows: Array<SavedAppointment & { details: string }> = [];
  for (let offset = 0; ; offset += 200) {
    let query = db.from('events').select('id,subject,event_date,event_time,all_day,related_type,related_id,client_id,status,meeting_type,duration_minutes,location,google_meet_url,zoom_join_url,sync_status,time_zone')
      .eq('user_id', actor).eq('status', 'scheduled').order('event_date').order('event_time').order('id').range(offset, offset + 199);
    if (ref.kind === 'client') query = query.or(`and(related_type.eq.client,related_id.eq.${ref.id}),client_id.eq.${ref.id}`);
    else query = query.eq('related_type', 'lead').eq('related_id', ref.id);
    query = appointmentId ? query.eq('id', appointmentId) : query.gte('event_date', calendarDate(new Date(), timeZone));
    const result = await query.returns<SavedAppointment[]>();
    if (result.error) throw databaseError(result.error);
    rows.push(...(result.data ?? []).map((row) => ({ ...row, details: appointmentDetails(row, row.time_zone ?? timeZone) })));
    if ((result.data?.length ?? 0) < 200) break;
  }
  if (appointmentId && !rows.length) throw new WorkspaceError('This appointment is not scheduled for this contact. Refresh the calendar.', 409);
  return { appointments: rows, facts };
}
