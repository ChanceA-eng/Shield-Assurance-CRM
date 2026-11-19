import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled } from '../../../../lib/agency-membership';
import { workspaceApiError, databaseError } from '../../../../lib/workspace-api';
import { resolveRecordScope } from '../../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  if (!agencyEnabled()) return NextResponse.json(null);
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const type = request.nextUrl.searchParams.get('record_type') === 'client' ? 'client' : 'lead';
    const id = request.nextUrl.searchParams.get('record_id') ?? '';
    await resolveRecordScope(db, { type, id });
    const member = await activeAgencyMember(db, session.user.id);
    const members = await db.from('agency_members').select('user_id,email,active').order('email');
    const record = await db.from(type === 'client' ? 'clients' : 'leads').select('agent_user_id').eq('id', id).single();
    if (members.error) throw databaseError(members.error);
    if (record.error) throw databaseError(record.error);
    return NextResponse.json({ member: { role: member.role }, members: members.data, agent_user_id: record.data.agent_user_id });
  } catch (error) { return workspaceApiError(error, 'agency/assignment'); }
}
