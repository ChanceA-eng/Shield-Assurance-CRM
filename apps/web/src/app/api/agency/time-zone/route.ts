import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getAgencyTimeZone } from '../../../../lib/automation-settings';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError } from '../../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    await activeAgencyMember(db, session.user.id);
    const timeZone = await getAgencyTimeZone(db);
    return NextResponse.json({ time_zone: timeZone }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'agency/time-zone');
  }
}
