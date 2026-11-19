import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { assertGmailEnabled } from '../../../../../lib/gmail-provider';
import { syncGmailConnection } from '../../../../../lib/gmail-sync';
import { workspaceApiError, databaseError } from '../../../../../lib/workspace-api';

export const maxDuration = 300;
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return NextResponse.json({ message: 'Unauthorized worker request.' }, { status: 401 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    assertGmailEnabled();
    const due = await db.from('gmail_connections').select('id,agency_members!inner(active)').eq('status', 'connected').eq('sync_enabled', true).eq('agency_members.active', true)
      .or(`sync_requested_at.not.is.null,last_sync_at.is.null,last_sync_at.lt.${new Date(Date.now() - 300000).toISOString()}`)
      .order('sync_started_at', { nullsFirst: true }).limit(2);
    if (due.error) throw databaseError(due.error);
    let processed = 0;
    let failed = 0;
    for (const connection of due.data ?? []) {
      try { processed += (await syncGmailConnection(db, connection.id)).processed; }
      catch { failed += 1; }
    }
    return NextResponse.json({ processed, failed, mailboxes: due.data?.length ?? 0,
      ...(failed ? { message: 'One or more mailbox syncs failed. See each connection health; successful mailboxes were not rolled back.' } : {}) }, { status: failed ? 503 : 200 });
  } catch (error) { return workspaceApiError(error, 'gmail/worker'); }
}
