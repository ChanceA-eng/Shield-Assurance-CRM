import { supabase } from '../_shared/supabaseClient.ts';
import { sendEmail, sendSMS } from '../_shared/messaging.ts';

Deno.serve(async () => {
  const now = new Date().toISOString();
  const { data: messages, error } = await supabase
    .from('scheduled_messages')
    .select('id,client_id,send_at,channel,subject,body,automation_type,clients(id,full_name,email,phone,email_consent,sms_consent)')
    .eq('status', 'pending')
    .lte('send_at', now);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  for (const message of messages ?? []) {
    const client = message.clients as {
      id: string;
      full_name?: string | null;
      email?: string | null;
      phone?: string | null;
      email_consent?: boolean | null;
      sms_consent?: boolean | null;
    } | null;

    if (message.channel === 'email' && client?.email && client.email_consent) {
      await sendEmail(client.email, message.subject ?? 'Follow-up', message.body);
    }

    if (message.channel === 'sms' && client?.phone && client.sms_consent) {
      await sendSMS(client.phone, message.body);
    }

    await supabase.from('communication_log').insert({
      client_id: message.client_id,
      channel: message.channel,
      direction: 'outbound',
      subject: message.subject,
      body: message.body,
      automation_type: message.automation_type,
    });

    await supabase.from('scheduled_messages').update({ status: 'sent' }).eq('id', message.id);
  }

  return new Response('Scheduled messages processed');
});
