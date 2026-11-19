import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { WorkspaceError } from '../../../lib/record-scope';
import { workspaceApiError } from '../../../lib/workspace-api';
import { conversationAppointments } from '../../../lib/appointment-confirmation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Appointments are unavailable. Refresh to retry.', 503);
    return NextResponse.json(await conversationAppointments(db, session.user.id, request.nextUrl.searchParams.get('conversation') ?? ''),
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'appointments/list'); }
}
