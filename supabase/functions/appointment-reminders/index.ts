import { supabase } from '../_shared/supabaseClient.ts';
import { sendEmail, sendSMS } from '../_shared/messaging.ts';

Deno.serve(async () => {
  const now = new Date();
  const hourAhead = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const dayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select('id,client_id,subject,event_date,event_time,clients(id,full_name,email,phone,email_consent,sms_consent)')
    .gte('event_date', now.toISOString().slice(0, 10))
    .lte('event_date', dayAhead.slice(0, 10));

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  for (const event of events ?? []) {
    const client = event.clients as {
      id: string;
      full_name?: string | null;
      email?: string | null;
      phone?: string | null;
      email_consent?: boolean | null;
      sms_consent?: boolean | null;
    } | null;

    const message = `Reminder: You have an appointment on ${event.event_date}${event.event_time ? ` at ${event.event_time}` : ''}.`;

    if (client?.email && client.email_consent) {
      await sendEmail(client.email, 'Appointment Reminder', message);
    }

    if (client?.phone && client.sms_consent) {
      await sendSMS(client.phone, message);
    }

    await supabase.from('communication_log').insert({
      client_id: event.client_id,
      channel: 'in_app',
      direction: 'outbound',
      subject: 'Appointment Reminder',
      body: message,
      automation_type: 'appointment',
    });
  }

  return new Response('Appointment reminders sent');
});
