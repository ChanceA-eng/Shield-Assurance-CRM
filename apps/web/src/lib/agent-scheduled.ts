import type { SupabaseClient } from '@supabase/supabase-js';
import { getAgentEmailSender } from './agent-email-sender';
import { getOwnGmailConnection } from './gmail-provider';
import { sendAgentEmail } from './agent-email';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { emailContentKey, parseEmailDesign } from '@crm/shared';
import { messageDocument } from './email-formatting';
import { assertTeamRecordSendAccess } from './team-request-access';

export async function assertScheduledSendAccess(
  db: SupabaseClient, actor: string | null, leadId: string | null, clientId: string | null,
): Promise<void> {
  const { data: allowed, error } = await db.rpc('team_scheduled_dispatch_allowed', {
    p_actor: actor, p_lead: leadId, p_client: clientId,
  });
  if (error) throw databaseError(error);
  if (allowed !== true) throw new WorkspaceError('The person who scheduled this message no longer has permission to send it for this record.', 403);
}

export async function assertOutreachSendAccess(db: SupabaseClient, actor: string, leadId: string): Promise<void> {
  await assertTeamRecordSendAccess(db, actor, leadId, null,
    'The person approving this outreach no longer has permission to send it for this record.');
}

export async function processAgentScheduled(db: SupabaseClient, limit = 50): Promise<{ sent: number; blocked: number }> {
  const rows = await db.from('scheduled_messages').select('*').not('gmail_connection_id', 'is', null)
    .eq('status', 'pending').lte('send_at', new Date().toISOString()).order('send_at').limit(limit);
  if (rows.error) throw databaseError(rows.error);
  let sent = 0;
  let blocked = 0;
  for (const row of rows.data ?? []) {
    const claim = await db.from('scheduled_messages').update({ status: 'processing' }).eq('id', row.id).eq('status', 'pending').select('id').maybeSingle();
    if (claim.error) throw databaseError(claim.error);
    if (!claim.data) continue;
    try {
      if (!row.agent_user_id || row.channel !== 'email') throw new Error('Legacy or non-email schedule requires review and an explicit agent identity.');
      const sender = await getAgentEmailSender(db, row.agent_user_id);
      const mailbox = await getOwnGmailConnection(db, row.agent_user_id);
      if (!mailbox || mailbox.id !== row.gmail_connection_id || emailContentKey(sender) !== emailContentKey(row.approved_sender)) throw new Error('Sender profile or mailbox changed. Review and recreate this scheduled message.');
      const target = {
        clientId: row.client_id, leadId: row.lead_id,
        ...(!row.client_id && !row.lead_id ? { conversationKey: `unmatched:${row.approved_recipient}` } : {}),
      };
      const recipient = await resolveOutboundEmailRecipient(db, target);
      if (!recipient.ok) throw new Error(recipient.message);
      if (recipient.recipient.to !== row.approved_recipient) throw new Error('Recipient changed. Review and recreate the scheduled message.');
      await assertScheduledSendAccess(db, row.agent_user_id, row.lead_id ?? null, row.client_id ?? null);
      await sendAgentEmail(db, row.agent_user_id, { to: recipient.recipient.to, subject: row.subject ?? 'Message from Shield Assurance', body: row.body,
        bodyDocument: messageDocument(row.body_document, row.body) },
        { attemptId: row.id, clientId: row.client_id, leadId: row.lead_id ?? null,
          ...(isRecord(row.sales_template) && typeof row.sales_template.id === 'string' && typeof row.sales_template.revision === 'number'
            ? { salesTemplate: { id: row.sales_template.id, revision: row.sales_template.revision,
              ...(row.sales_template.email_design ? { email_design: parseEmailDesign(row.sales_template.email_design) } : {}) } } : {}) },
        async () => {
          const current = await resolveOutboundEmailRecipient(db, target);
          if (!current.ok) throw new WorkspaceError(current.message, current.status);
          if (current.recipient.to !== recipient.recipient.to || current.recipient.leadId !== recipient.recipient.leadId
            || current.recipient.clientId !== recipient.recipient.clientId) {
            throw new WorkspaceError('Recipient or linked record changed. Review and recreate this scheduled message.', 409);
          }
          await assertScheduledSendAccess(db, row.agent_user_id, row.lead_id ?? null, row.client_id ?? null);
        });
      const saved = await db.from('scheduled_messages').update({ status: 'sent', last_error: null }).eq('id', row.id).eq('status', 'processing');
      if (saved.error) throw databaseError(saved.error);
      sent += 1;
    } catch (error) {
      const limited = error instanceof WorkspaceError && error.status === 429;
      const saved = await db.from('scheduled_messages').update({
        status: limited ? 'pending' : 'failed',
        ...(limited ? { send_at: new Date(Date.now() + 15 * 60000).toISOString() } : {}),
        last_error: error instanceof Error ? error.message : 'Scheduled send blocked. Review mailbox state before retrying.',
      }).eq('id', row.id).eq('status', 'processing');
      if (saved.error) throw databaseError(saved.error);
      blocked += 1;
    }
  }
  return { sent, blocked };
}
