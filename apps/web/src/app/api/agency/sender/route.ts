import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { agencyEnabled, agentSender } from '../../../../lib/agency-membership';
import { getOwnGmailConnection } from '../../../../lib/gmail-provider';
import { workspaceApiError } from '../../../../lib/workspace-api';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  if (!agencyEnabled()) return NextResponse.json({ enabled: false });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const sender = await agentSender(db, session.user.id);
    const mailbox = await getOwnGmailConnection(db, session.user.id);
    return NextResponse.json({ enabled: true, name: sender.name, email: mailbox?.email ?? null, status: mailbox?.status ?? 'not_connected' });
  } catch (error) { return workspaceApiError(error, 'agency/sender'); }
}
