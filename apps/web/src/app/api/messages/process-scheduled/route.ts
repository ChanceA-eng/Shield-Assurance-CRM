import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { sendEmail } from '../../../../lib/messaging';
import { appendAgencySignature } from '../../../../lib/agency-signature';

interface ScheduledMessageRow {
  id: string;
  client_id: string | null;
  send_at: string;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  automation_type: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // Support both explicit secret auth and Vercel cron user agent.
  if (cronSecret && bearer === cronSecret) return true;

  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  if (userAgent.includes('vercel-cron')) return true;

  // Allow local/manual trigger when no secret is configured.
  return !cronSecret;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ message: 'Unauthorized cron request.' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 100;

  const dueMessagesResult = await supabase
    .from('scheduled_messages')
    .select('id,client_id,send_at,channel,subject,body,automation_type,status')
    .eq('status', 'pending')
    .lte('send_at', nowIso)
    .order('send_at', { ascending: true })
    .limit(limit);

  if (dueMessagesResult.error) {
    return NextResponse.json({ message: dueMessagesResult.error.message }, { status: 500 });
  }

  const dueMessages = (dueMessagesResult.data ?? []) as ScheduledMessageRow[];
  if (dueMessages.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 }, { status: 200 });
  }

  let sent = 0;
  let failed = 0;

  for (const message of dueMessages) {
    let deliveryError: string | null = null;

    if (!message.client_id) {
      deliveryError = 'Missing client_id on scheduled message.';
    }

    const clientLookup =
      !deliveryError && message.client_id
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

    if (!deliveryError && !client) {
      deliveryError = 'Client not found for scheduled message.';
    }

    if (!deliveryError && message.channel === 'email') {
      const preferred = (client?.preferred_channel ?? '').trim().toLowerCase();
      const emailAllowed = Boolean(client?.email_consent) || preferred === 'email' || preferred === 'both';
      const recipientEmail = (client?.email ?? '').trim().toLowerCase();
      const signatureStyle = message.automation_type.trim().toLowerCase() === 'manual' ? 'personal' : 'system';
      const signedBody = appendAgencySignature(message.body, signatureStyle);

      if (!emailAllowed) {
        deliveryError = 'Client has not consented to email.';
      } else if (!recipientEmail) {
        deliveryError = 'Client email is missing.';
      } else {
        try {
          await sendEmail({
            to: recipientEmail,
            subject: message.subject?.trim() || 'Message from Shield Assurance',
            body: signedBody,
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
                      message.automation_type.trim().toLowerCase() === 'manual' ? 'personal' : 'system',
                    )
                  : message.body,
              automation_type: message.automation_type,
              sent_at: sentAt,
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
        supabase.from('scheduled_messages').update({ status: 'failed' }).eq('id', message.id),
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
      processed: dueMessages.length,
      sent,
      failed,
    },
    { status: 200 },
  );
}
