import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { isUuid } from '../../../../../lib/workspace-validation';
import { sendAppointmentNotification } from '../../../../../lib/appointment-notifications';

export async function POST(request: NextRequest, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const { eventId } = await context.params, body = await workspaceBody(request);
    if (!isUuid(eventId) || body.confirmed !== true || typeof body.conversation !== 'string') throw new WorkspaceError('Confirm the saved appointment and contact before sending.', 400);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Appointment confirmation is unavailable. Nothing was sent.', 503);
    return NextResponse.json(await sendAppointmentNotification(db, session.user.id, eventId, body.conversation, body.kind));
  } catch (error) { return workspaceApiError(error, 'appointments/confirmation'); }
}
