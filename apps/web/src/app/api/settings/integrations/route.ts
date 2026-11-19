import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { gmailSetupIssues } from '../../../../lib/agency-membership';
import { emailConnectionStatus } from '../../../../lib/email-setup';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, friendlyErrorMessage, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

type IntegrationState = 'missing' | 'configured' | 'healthy' | 'failed';

interface IntegrationStatus {
  id: string;
  name: string;
  state: IntegrationState;
  detail: string;
  connections?: Array<{ email: string; status: string; last_sync_at: string | null; watch_expires_at: string | null; bootstrap_complete: boolean }>;
}

function isHealthyGmailWatch(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) > Date.now();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    await requireAgencyOwner(db, session.user.id);
    const databaseCheck = await db.from('agency_members').select('user_id', { head: true, count: 'exact' });
    if (databaseCheck.error) throw databaseError(databaseCheck.error);

    const [emailResult, membersResult, gmailResult] = await Promise.allSettled([
      emailConnectionStatus(db, session.user.id),
      db.from('agency_members').select('user_id').eq('active', true),
      db.from('gmail_connections').select('user_id,email,status,last_sync_at,watch_expires_at,bootstrap_complete').order('email'),
    ]);

    const integrations: IntegrationStatus[] = [{
      id: 'database',
      name: 'CRM database',
      state: 'healthy',
      detail: 'Connected and responding.',
    }];

    if (emailResult.status === 'fulfilled') {
      const email = emailResult.value;
      integrations.push({
        id: 'resend',
        name: 'Email delivery (Resend)',
        state: email.sendingEnabled && email.domainStatus === 'verified' && email.issues.length === 0
          ? 'healthy'
          : process.env.RESEND_API_KEY?.trim() ? 'configured' : 'missing',
        detail: email.issues.length ? email.issues.join(' ') : `Sending domain ${email.domainStatus}; reply verification ${email.replyReady ? 'complete' : 'pending'}.`,
      });
    } else {
      console.error('[settings/integrations] Resend status check failed', emailResult.reason);
      integrations.push({
        id: 'resend',
        name: 'Email delivery (Resend)',
        state: 'failed',
        detail: friendlyErrorMessage({ message: emailResult.reason instanceof Error ? emailResult.reason.message : 'Provider check failed.' }),
      });
    }

    const setupIssues = gmailSetupIssues();
    if (membersResult.status === 'rejected' || membersResult.value.error) {
      const failure = membersResult.status === 'rejected' ? membersResult.reason : membersResult.value.error;
      console.error('[settings/integrations] Agency member status check failed', failure);
      throw new WorkspaceError('Gmail connection status could not be checked. Refresh or contact your administrator.', 503);
    }
    if (gmailResult.status === 'rejected' || gmailResult.value.error) {
      const failure = gmailResult.status === 'rejected' ? gmailResult.reason : gmailResult.value.error;
      console.error('[settings/integrations] Gmail status query failed', failure);
      throw new WorkspaceError('Gmail connection status could not be checked. Refresh or contact your administrator.', 503);
    }

    const memberIds = new Set((membersResult.value.data ?? []).map((member) => member.user_id));
    const connections = (gmailResult.value.data ?? [])
      .filter((connection) => memberIds.has(connection.user_id))
      .map((connection) => ({
        email: connection.email,
        status: connection.status,
        last_sync_at: connection.last_sync_at,
        watch_expires_at: connection.watch_expires_at,
        bootstrap_complete: connection.bootstrap_complete,
      }));
    const gmailState: IntegrationState = setupIssues.length ? 'missing'
      : connections.some((connection) => connection.status === 'reconnect'
        || (connection.status === 'connected' && !isHealthyGmailWatch(connection.watch_expires_at))) ? 'failed'
        : connections.length > 0 && connections.every((connection) => connection.status === 'connected' && connection.bootstrap_complete)
          ? 'healthy'
          : 'configured';
    const gmailDetail = setupIssues.length
      ? setupIssues.join(' ')
      : connections.length
        ? `${connections.filter((connection) => connection.status === 'connected').length} of ${connections.length} active mailboxes connected.`
        : 'Google OAuth is configured; no agent mailbox is connected.';
    integrations.push({ id: 'gmail', name: 'Agent Gmail', state: gmailState, detail: gmailDetail, connections });

    const aiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
    integrations.push({
      id: 'openai',
      name: 'AI assistance (OpenAI)',
      state: aiConfigured ? 'configured' : 'missing',
      detail: aiConfigured
        ? 'Provider credentials are present; provider reachability is checked when an AI feature runs.'
        : 'AI features that require a provider key are unavailable. Free/manual workflows remain available.',
    });

    return NextResponse.json({ integrations }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'settings/integrations');
  }
}
