import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';
import { isUuid } from '../../../lib/workspace-validation';
import { validateCalendarChange } from '../../../lib/calendar-event';
import { getAgencyTimeZone } from '../../../lib/automation-settings';
import { prepareAppointmentChange, safeAppointment, syncAppointment, type Appointment } from '../../../lib/appointment-lifecycle';
import { activeAgencyMember } from '../../../lib/agency-membership';
import { requireTeamPermission } from '../../../lib/team-request-access';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'calendar.view', 'self');
    await activeAgencyMember(db, session.user.id);
    const params = request.nextUrl.searchParams;
    const status = params.get('status') ?? 'all';
    if (!['all', 'scheduled', 'completed', 'cancelled'].includes(status)) throw new WorkspaceError('Invalid event status.', 400);
    const offset = Number(params.get('offset') ?? '0');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceError('Invalid event offset.', 400);
    let query = (session.teamAccess?.mode === 'restricted'
      ? db.rpc('team_calendar_events', { p_actor: session.user.id }, { count: 'exact' }).select('*')
      : db.from('events').select('*', { count: 'exact' }).eq('user_id', session.user.id))
      .order('event_date', { ascending: params.get('order') !== 'desc' }).order('id').range(offset, offset + 199);
    if (status !== 'all') query = query.eq('status', status);
    for (const field of ['related_id', 'client_id', 'id']) {
      const value = params.get(field);
      if (value) {
        if (!isUuid(value)) throw new WorkspaceError('Choose a valid related record.', 400);
        query = query.eq(field, value);
      }
    }
    if (params.get('related_type')) query = query.eq('related_type', params.get('related_type'));
    for (const [field, operator] of [['start', 'gte'], ['end', 'lt']] as const) {
      const value = params.get(field);
      if (!value) continue;
      if (validateCalendarChange({ event_date: value })) throw new WorkspaceError('Choose a valid calendar range.', 400);
      query = query[operator]('event_date', value);
    }
    const { data, count, error } = await query;
    if (error) throw databaseError(error);
    return NextResponse.json((data ?? []).map((row: Appointment) => safeAppointment(row)), { headers: { 'X-Total-Count': String(count ?? 0), 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'events/get'); }
}

async function save(request: NextRequest, create: boolean): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'calendar.edit', 'self');
    const body = await workspaceBody(request);
    const basicError = validateCalendarChange(body);
    if (basicError) throw new WorkspaceError(basicError, 400);
    const timeZone = await getAgencyTimeZone(db);
    const id = create ? body.id ?? randomUUID() : body.id;
    if (!isUuid(id)) throw new WorkspaceError('A valid event id is required.', 400);
    for (const field of ['related_id', 'client_id']) if (body[field] && !isUuid(body[field])) throw new WorkspaceError('Choose a valid lead or account.', 400);
    if (body.related_id === '') body.related_id = null;
    if (body.client_id === '') body.client_id = null;
    if (body.related_type === '') body.related_type = null;
    if (!create && session.teamAccess?.mode === 'restricted') {
      const allowed = await db.rpc('assert_team_calendar_access', { p_actor: session.user.id, p_event: id, p_permission: 'calendar.edit' });
      if (allowed.error) throw databaseError(allowed.error);
    }
    const candidate = await prepareAppointmentChange(db, session.user.id, id, body, create, timeZone);
    const error = validateCalendarChange(body, candidate.time_zone);
    if (error) throw new WorkspaceError(error, 400);
    const result = await db.rpc('save_calendar_event', { p_id: id, p_changes: body, p_create: create, p_actor: apiActorName(session.user), p_user: session.user.id });
    if (result.error) throw databaseError(result.error);
    let event = result.data as Appointment;
    if (event.sync_status !== 'not_required') {
      try { event = await syncAppointment(db, session.user.id, id); }
      catch (error) {
        // Booking is already committed. Never turn a provider/lease failure into
        // a generic save error that invites a second booking.
        event = { ...event, sync_status: 'pending', sync_error: error instanceof WorkspaceError ? error.message : 'Appointment saved. Retry calendar sync.' };
      }
    }
    return NextResponse.json(safeAppointment(event), { status: create ? 201 : 200 });
  } catch (error) { return workspaceApiError(error, 'events/save'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> { return save(request, true); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return save(request, false); }
