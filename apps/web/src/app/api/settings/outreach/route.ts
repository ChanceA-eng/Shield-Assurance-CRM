import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getAutomationSettings } from '../../../../lib/automation-settings';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import type { OutreachSender } from '@crm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOutreachSender } from '../../../../lib/marketing-profile';
import { senderOptions } from '../../../../lib/sender-options';

export { PATCH } from '../../outreach/route';

async function activeSenderProfiles(db: SupabaseClient): Promise<OutreachSender[]> {
  const profiles: OutreachSender[] = [];
  for (let offset = 0; ; offset += 100) {
    const members = await db.from('agency_members').select('sender_profile').eq('active', true)
      .not('sender_profile', 'is', null).order('user_id').range(offset, offset + 99)
      .returns<Array<{ sender_profile: unknown }>>();
    if (members.error) throw databaseError(members.error);
    const rows = members.data ?? [];
    profiles.push(...rows.map((member) => parseOutreachSender(member.sender_profile)));
    if (rows.length < 100) return profiles;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const [current, profiles] = await Promise.all([getAutomationSettings(db), activeSenderProfiles(db)]);
    const settings = current.configuration.outreach;
    return NextResponse.json({
      settings, revision: current.revision, sender_options: senderOptions([settings.sender_profile, ...profiles], typeof session.user.user_metadata.full_name === 'string' ? session.user.user_metadata.full_name : undefined),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'settings/outreach'); }
}
