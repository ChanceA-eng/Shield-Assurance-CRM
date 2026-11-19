import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { sendOutboundEmail } from '../../../../lib/email-adapter';
import { resolveOutboundEmailRecipient } from '../../../../lib/message-delivery';
import { appendAgencySignature, appendPersonalSignature } from '../../../../lib/agency-signature';
import { assertScheduledSendAccess, processAgentScheduled } from '../../../../lib/agent-scheduled';
import { workspaceApiError, friendlyErrorMessage } from '../../../../lib/workspace-api';
import { trackedAutomation } from '../../../../lib/automation-health';
import { parseEmailDocument, type EmailFormatting, type EmailDocument, type SalesTemplateSnapshot } from '@crm/shared';

interface ScheduledMessageRow {
  id: string;
  agent_user_id: string | null;
  client_id: string | null;
  lead_id: string | null;
  approved_recipient: string | null;
  gmail_connection_id: string | null;
  sales_template?: SalesTemplateSnapshot | null;
  approved_sender?: ({ signature?: string } & EmailFormatting) | null;
  body_document?: EmailDocument | null;
  send_at: string;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  automation_type: string | null;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // Support both explicit secret auth and Vercel cron user agent.
  if (cronSecret && bearer === cronSecret) return true;

  return false;
}

async function processScheduled(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ message: 'Unauthorized cron request.' }, { status: 401 });
  }
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 100;
  let gmailResult: { sent: number; blocked: number };
  try { gmailResult = await processAgentScheduled(supabase, Math.min(limit, 50)); }
  catch (error) { return workspaceApiError(error, 'scheduled/agent-processing'); }

  const nowIso = new Date().toISOString();

  const dueMessagesResult = await supabase
    .from('scheduled_messages')
    .select('id,agent_user_id,client_id,lead_id,approved_recipient,gmail_connection_id,sales_template,approved_sender,body_document,send_at,channel,subject,body,automation_type,status')
    .eq('status', 'pending')
    .is('gmail_connection_id', null)
    .lte('send_at', nowIso)
    .order('send_at', { ascending: true })
    .limit(limit);

  if (dueMessagesResult.error) {
    return NextResponse.json({ message: friendlyErrorMessage(dueMessagesResult.error) }, { status: 500 });
  }

  const dueMessages = (dueMessagesResult.data ?? []) as ScheduledMessageRow[];
  if (dueMessages.length === 0) {
    return NextResponse.json({ ok: true, processed: gmailResult.sent + gmailResult.blocked, sent: gmailResult.sent, failed: gmailResult.blocked }, { status: 200 });
  }

  let sent = 0;
  let failed = 0;

  for (const message of dueMessages) {
    const claim = await supabase.from('scheduled_messages').update({ status: 'processing' })
      .eq('id', message.id).eq('status', 'pending').select('id').maybeSingle();
    if (claim.error) return NextResponse.json({ message: friendlyErrorMessage(claim.error) }, { status: 500 });
    if (!claim.data) continue;
    let deliveryError: string | null = null;

    const contactEmail = Boolean(message.lead_id || (!message.client_id && message.approved_recipient));
    if (contactEmail) {
      try {
        if (message.gmail_connection_id) throw new Error('This email requires the approved Gmail mailbox. Shared-provider fallback is disabled.');
        const target = await resolveOutboundEmailRecipient(supabase, message.lead_id ? { leadId: message.lead_id }
          : { conversationKey: `unmatched:${message.approved_recipient}` });
        if (!target.ok) throw new Error(target.message);
        if (target.recipient.to !== message.approved_recipient) throw new Error('Recipient changed. Review and recreate this scheduled email.');
        if (message.channel !== 'email') throw new Error('Only email scheduling is supported for leads.');
        if (message.agent_user_id || message.automation_type?.trim().toLowerCase() === 'manual') {
          await assertScheduledSendAccess(supabase, message.agent_user_id ?? null, message.lead_id ?? null, message.client_id ?? null);
        }
        await sendOutboundEmail({
          to: target.recipient.to,
          subject: message.subject?.trim() || 'Message from Shield Assurance',
          body: message.approved_sender?.signature ? appendPersonalSignature(message.body, message.approved_sender.signature) : appendAgencySignature(message.body, 'personal'),
          bodyDocument: parseEmailDocument(message.body_document),
          signatureDocument: message.approved_sender?.signatureDocument,
          signatureRows: message.approved_sender?.signatureRows,
          emailDesign: message.sales_template?.email_design,
          requestId: `scheduled:${message.id}`,
          leadId: message.lead_id ?? undefined,
        });
      } catch (error) {
        deliveryError = error instanceof Error ? error.message : 'Scheduled lead email failed.';
      }
    }

    if (!contactEmail && !message.client_id) {
      deliveryError = 'Missing client_id on scheduled message.';
    }

    const clientLookup =
      !contactEmail && !deliveryError && message.client_id
        ? await supabase
            .from('clients')
            .select('id,email,phone,email_consent,sms_consent,preferred_channel')
            .eq('id', message.client_id)
            .maybeSingle()
        : null;

    if (!deliveryError && clientLookup?.error) {
      deliveryError = clientLookup.error.message;
    }

    const client = clientLookup?.data;

    if (!contactEmail && !deliveryError && !client) {
      deliveryError = 'Client not found for scheduled message.';
    }

    if (!contactEmail && !deliveryError && message.channel === 'email') {
      const preferred = (client?.preferred_channel ?? '').trim().toLowerCase();
      const emailAllowed = Boolean(client?.email_consent) || preferred === 'email' || preferred === 'both';
      const recipientEmail = (client?.email ?? '').trim().toLowerCase();
      const signatureStyle = message.automation_type?.trim().toLowerCase() === 'manual' ? 'personal' : 'system';
      const signedBody = message.approved_sender?.signature ? appendPersonalSignature(message.body, message.approved_sender.signature) : appendAgencySignature(message.body, signatureStyle);

      if (!emailAllowed) {
        deliveryError = 'Client has not consented to email.';
      } else if (!recipientEmail) {
        deliveryError = 'Client email is missing.';
      } else {
        try {
          const target = await resolveOutboundEmailRecipient(supabase, { clientId: message.client_id, to: recipientEmail });
          if (!target.ok) throw new Error(target.message);
          if (message.gmail_connection_id) throw new Error('This email requires the approved Gmail mailbox. Shared-provider fallback is disabled.');
          if (message.approved_recipient && recipientEmail !== message.approved_recipient) throw new Error('Recipient changed. Review and recreate this scheduled email.');
          if (message.agent_user_id || message.automation_type?.trim().toLowerCase() === 'manual') {
            await assertScheduledSendAccess(supabase, message.agent_user_id ?? null, message.lead_id ?? null, message.client_id ?? null);
          }
          await sendOutboundEmail({
            to: recipientEmail,
            bodyDocument: parseEmailDocument(message.body_document),
            signatureDocument: message.approved_sender?.signatureDocument,
            signatureRows: message.approved_sender?.signatureRows,
            subject: message.subject?.trim() || 'Message from Shield Assurance',
            body: signedBody,
            emailDesign: message.sales_template?.email_design,
            requestId: `scheduled:${message.id}`,
            clientId: message.client_id ?? undefined,
          });
        } catch (error) {
          deliveryError = error instanceof Error ? error.message : 'Unknown email send error';
        }
      }
    }

    if (!deliveryError && message.channel === 'sms') {
      const preferred = (client?.preferred_channel ?? '').trim().toLowerCase();
      const smsAllowed = Boolean(client?.sms_consent) || preferred === 'sms' || preferred === 'both';
      if (!smsAllowed) {
        deliveryError = 'Client has not consented to SMS.';
      } else {
        // SMS provider integration is not configured yet.
        deliveryError = 'SMS delivery provider is not configured.';
      }
    }

    if (!deliveryError) {
      const sentAt = new Date().toISOString();

      const [insertLogResult, updateScheduledResult] = await Promise.all([
        supabase
          .from('communication_log')
          .insert([
            {
              client_id: message.client_id,
              channel: message.channel,
              direction: 'outbound',
              subject: message.subject?.trim() || null,
              body:
                message.channel === 'email'
                  ? appendAgencySignature(
                      message.body,
                      message.automation_type?.trim().toLowerCase() === 'manual' ? 'personal' : 'system',
                    )
                  : message.body,
              automation_type: message.automation_type,
              sent_at: sentAt,
              metadata: { provider: 'resend', delivery_status: 'accepted_by_provider', scheduled_message_id: message.id,
                ...(message.approved_recipient ? { to: message.approved_recipient } : {}),
                ...(message.sales_template ? { sales_template: message.sales_template } : {}),
                ...(message.lead_id ? { lead_id: message.lead_id } : {}) },
            },
          ])
          .select('id')
          .single(),
        supabase.from('scheduled_messages').update({ status: 'sent' }).eq('id', message.id),
      ]);

      if (insertLogResult.error || updateScheduledResult.error) {
        const reason = insertLogResult.error?.message || updateScheduledResult.error?.message || 'Failed to finalize sent status.';
        await supabase.from('scheduled_messages').update({ status: 'failed' }).eq('id', message.id);
        await supabase.from('notifications').insert([
          {
            client_id: message.client_id,
            type: 'message_delivery_failed',
            message: `Scheduled message failed: ${reason}`,
            read: false,
          },
        ]);
        failed += 1;
      } else {
        sent += 1;
      }
    } else {
      await Promise.all([
        supabase.from('scheduled_messages').update({ status: 'failed', last_error: deliveryError }).eq('id', message.id),
        supabase.from('notifications').insert([
          {
            client_id: message.client_id,
            type: 'message_delivery_failed',
            message: `Scheduled message failed: ${deliveryError}`,
            read: false,
          },
        ]),
      ]);
      failed += 1;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      processed: dueMessages.length + gmailResult.sent + gmailResult.blocked,
      sent: sent + gmailResult.sent,
      failed: failed + gmailResult.blocked,
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) return NextResponse.json({ message: 'Unauthorized cron request.' }, { status: 401 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const run = await trackedAutomation(db, 'scheduled-messages', async () => {
      const response = await processScheduled(request);
      const result: Record<string, unknown> = await response.json();
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Scheduled processing failed.');
      const failures = Number(result.failed ?? 0) + Number(result.blocked ?? 0);
      return { status: failures > 0 ? 'partial' : 'succeeded', summary: result,
        error: failures > 0 ? `${failures} scheduled messages could not be sent. Check their recorded results before retrying.` : undefined };
    });
    return NextResponse.json({ ...run.summary, ok: run.status === 'succeeded', ...(run.error ? { message: run.error } : {}) },
      { status: run.status === 'succeeded' ? 200 : 207 });
  } catch (error) { return workspaceApiError(error, 'scheduled/processing'); }
}
