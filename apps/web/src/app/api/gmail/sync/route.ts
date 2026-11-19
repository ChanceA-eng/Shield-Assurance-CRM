import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getOwnGmailConnection } from '../../../../lib/gmail-provider';
import { workspaceApiError, databaseError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const connection = await getOwnGmailConnection(db, session.user.id);
    if (!connection || connection.status !== 'connected') throw new WorkspaceError('Connect Gmail before requesting sync.', 409);
    if (!connection.sync_enabled) throw new WorkspaceError('This Gmail connection is send-only and does not read or sync mailbox conversations.', 403);
    const { error } = await db.from('gmail_connections').update({ sync_requested_at: new Date().toISOString() }).eq('id', connection.id);
    if (error) throw databaseError(error);
    return NextResponse.json({ message: 'Sync queued. The background worker must be running.' }, { status: 202 });
  } catch (error) { return workspaceApiError(error, 'gmail/sync'); }
}
