import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { managedAppointment, manageAppointment } from '../../../../../lib/appointment-management';
import { publicAppointment } from '../../../../../lib/appointment-lifecycle';
import { workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { calendarCallbackUrl } from '../../../../../lib/google-calendar';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Appointment management is temporarily unavailable.', 503);
    const event = await managedAppointment(db, (await context.params).token);
    return NextResponse.json({ appointment: publicAppointment(event), allowed_durations: [event.duration_minutes] }, { headers });
  } catch (error) {
    const response = workspaceApiError(error, 'appointments/manage/get');
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && ![request.nextUrl.origin, calendarCallbackUrl().origin].includes(origin)
      || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new WorkspaceError('Manage appointments from the secure appointment link using JSON.', 403);
    }
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Appointment management is temporarily unavailable.', 503);
    const event = await managedAppointment(db, (await context.params).token);
    const result = await manageAppointment(db, event, await workspaceBody(request));
    return NextResponse.json({ appointment: publicAppointment(result.event), notification: result.notification }, { headers });
  } catch (error) {
    const response = workspaceApiError(error, 'appointments/manage/post');
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
