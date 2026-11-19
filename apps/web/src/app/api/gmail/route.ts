import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { getOwnGmailConnection, gmailRequest, googleOAuthClient, openGmailSecret } from '../../../lib/gmail-provider';
import { agencyEnabled } from '../../../lib/agency-membership';
import { workspaceApiError, databaseError } from '../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const connection = await getOwnGmailConnection(db, session.user.id);
    let review: Array<{ gmail_thread_id: string; reason: string | null }> = [];
    if (connection?.sync_enabled) {
      const result = await db.from('gmail_thread_links').select('gmail_thread_id,reason').eq('connection_id', connection.id).eq('status', 'needs_review').limit(50);
      if (result.error) throw databaseError(result.error);
      review = result.data ?? [];
    }
    return NextResponse.json({
      connection,
      review,
      default_provider: agencyEnabled() ? 'gmail' : 'resend',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'gmail/status'); }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const connection = await getOwnGmailConnection(db, session.user.id);
    if (!connection) return NextResponse.json({ ok: true });
    const token = await db.from('gmail_tokens').select('refresh_secret').eq('connection_id', connection.id).maybeSingle();
    if (token.error) throw databaseError(token.error);
    let watchStopped = !connection.sync_enabled || connection.status !== 'connected';
    if (connection.sync_enabled && connection.status === 'connected') {
      try { await gmailRequest(db, connection.id, '/stop', { method: 'POST' }); watchStopped = true; }
      catch { watchStopped = false; }
    }
    // Local disable and credential deletion are mandatory even when Google is unavailable.
    const disconnected = await db.rpc('disconnect_agent_gmail', { p_user: session.user.id });
    if (disconnected.error) throw databaseError(disconnected.error);
    let revoked = true;
    if (token.data) {
      try { await googleOAuthClient().revokeToken(openGmailSecret(token.data.refresh_secret, session.user.id)); }
      catch { revoked = false; }
    }
    return NextResponse.json({ ok: true, message: revoked && watchStopped ? 'Gmail disconnected. Shared CRM history remains.' : 'Disconnected locally. Google watch shutdown or revocation could not be confirmed; remove CRM access in your Google account permissions. Shared CRM history remains.' });
  } catch (error) { return workspaceApiError(error, 'gmail/disconnect'); }
}
