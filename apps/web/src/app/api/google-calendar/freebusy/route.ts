import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { calendarBusy } from '../../../../lib/google-calendar';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { ownedAppointment } from '../../../../lib/appointment-lifecycle';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    const body = await workspaceBody(request);
    if (typeof body.start !== 'string' || typeof body.end !== 'string') throw new WorkspaceError('Provide an availability start and end.', 400);
    const event = body.event_id ? await ownedAppointment(db, session.user.id, String(body.event_id)) : null;
    return NextResponse.json({ busy: await calendarBusy(db, session.user.id, body.start, body.end, event?.google_event_id ?? undefined) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return workspaceApiError(error, 'google-calendar/freebusy'); }
}
