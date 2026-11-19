import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { ownedAppointment, syncAppointment } from '../../../../../lib/appointment-lifecycle';
import { workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';

export async function POST(request: NextRequest, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    const { eventId } = await context.params;
    await ownedAppointment(db, session.user.id, eventId);
    const body = request.headers.get('content-type')?.includes('application/json') ? await workspaceBody(request) : {};
    if (Object.keys(body).some((key) => !['confirm_zoom_not_created', 'expected_revision'].includes(key))
      || body.confirm_zoom_not_created !== undefined && body.confirm_zoom_not_created !== true
      || body.confirm_zoom_not_created === true && (typeof body.expected_revision !== 'number' || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0)) {
      throw new WorkspaceError('Confirm the current appointment before resolving Zoom creation.', 400);
    }
    return NextResponse.json(await syncAppointment(db, session.user.id, eventId, body.confirm_zoom_not_created === true && typeof body.expected_revision === 'number'
      ? { confirmedMissing: true, revision: body.expected_revision } : undefined));
  } catch (error) { return workspaceApiError(error, 'appointments/sync'); }
}
