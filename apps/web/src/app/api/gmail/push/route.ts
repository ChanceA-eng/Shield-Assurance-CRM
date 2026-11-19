import { OAuth2Client } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { assertGmailEnabled } from '../../../../lib/gmail-provider';
import { workspaceApiError, workspaceBody, databaseError } from '../../../../lib/workspace-api';
import { isRecord } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    assertGmailEnabled();
    const audience = process.env.GMAIL_PUBSUB_AUDIENCE;
    const expectedEmail = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!audience || !expectedEmail || !token) throw new WorkspaceError('Pub/Sub authentication is not configured.', 401);
    let payload;
    try { payload = (await new OAuth2Client().verifyIdToken({ idToken: token, audience })).getPayload(); }
    catch { throw new WorkspaceError('Invalid Pub/Sub identity.', 401); }
    if (payload?.email !== expectedEmail || !payload.email_verified) throw new WorkspaceError('Unexpected Pub/Sub service identity.', 401);
    const body = await workspaceBody(request);
    if (!isRecord(body.message) || typeof body.message.data !== 'string' || body.message.data.length > 20000) throw new WorkspaceError('Invalid Gmail notification.', 400);
    let data: unknown;
    try { data = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')); }
    catch { throw new WorkspaceError('Invalid Gmail notification data.', 400); }
    if (!isRecord(data) || typeof data.emailAddress !== 'string' || typeof data.historyId !== 'string') throw new WorkspaceError('Invalid Gmail notification identity.', 400);
    const { error } = await db.from('gmail_connections').update({ sync_requested_at: new Date().toISOString() })
      .eq('email', data.emailAddress.toLowerCase()).eq('status', 'connected').eq('sync_enabled', true);
    if (error) throw databaseError(error);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return workspaceApiError(error, 'gmail/push'); }
}
