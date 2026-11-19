import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { ownCalendarConnection } from '../../../lib/google-calendar';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    return NextResponse.json({ connection: await ownCalendarConnection(db, session.user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'google-calendar/status'); }
}
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await ownCalendarConnection(db, session.user.id);
    const result = await db.rpc('disconnect_google_calendar', { p_user: session.user.id });
    if (result.error) throw databaseError(result.error);
    // Google revocation can revoke all scopes for this OAuth client, including
    // existing Gmail send-only access. Delete only the isolated Calendar grant.
    return NextResponse.json({ ok: true, message: 'Calendar disconnected locally. Existing appointments and Gmail authorization are unchanged.' });
  } catch (error) { return workspaceApiError(error, 'google-calendar/disconnect'); }
}
