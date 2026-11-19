import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { ownZoomConnection, zoomConfigured } from '../../../lib/zoom-provider';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    return NextResponse.json({ connection: await ownZoomConnection(db, session.user.id), configured: zoomConfigured() },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'zoom/status'); }
}
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is unavailable.', 503);
    await ownZoomConnection(db, session.user.id);
    const result = await db.rpc('disconnect_zoom', { p_user: session.user.id });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json({ message: 'Zoom disconnected from the CRM. Existing meetings remain in Zoom; reconnect to update them.' });
  } catch (error) { return workspaceApiError(error, 'zoom/disconnect'); }
}
