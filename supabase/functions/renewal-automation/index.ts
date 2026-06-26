import { supabase } from '../_shared/supabaseClient.ts';
import { sendEmail, sendSMS } from '../_shared/messaging.ts';

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { data: policies, error } = await supabase
    .from('policies')
    .select('id,client_id,insured_name,carrier,renewal_date,clients(id,full_name,email,phone,email_consent,sms_consent)')
    .eq('renewal_date', today)
    .in('status', ['active', 'issued']);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  for (const policy of policies ?? []) {
    const client = policy.clients as {
      id: string;
      full_name?: string | null;
      email?: string | null;
      phone?: string | null;
      email_consent?: boolean | null;
      sms_consent?: boolean | null;
    } | null;

    await supabase.from('tasks').insert({
      subject: `Renewal review for ${client?.full_name ?? policy.insured_name ?? 'client'}`,
      due_date: policy.renewal_date,
      priority: 'medium',
      status: 'open',
      related_type: 'policy',
      related_id: policy.id,
    });

    await supabase.from('events').insert({
      client_id: policy.client_id,
      subject: `Renewal review: ${client?.full_name ?? policy.insured_name ?? 'client'}`,
      title: `Renewal review: ${client?.full_name ?? policy.insured_name ?? 'client'}`,
      event_date: policy.renewal_date,
      all_day: true,
      status: 'scheduled',
      related_type: 'policy',
      related_id: policy.id,
    });

    await supabase.from('notifications').insert({
      client_id: policy.client_id,
      type: 'renewal',
      message: `Renewal review scheduled for ${policy.renewal_date}`,
      read: false,
    });

    await supabase.from('communication_log').insert({
      client_id: policy.client_id,
      channel: 'in_app',
      direction: 'outbound',
      subject: 'Renewal Reminder',
      body: `Your policy renews on ${policy.renewal_date}.`,
      automation_type: 'renewal',
    });

    if (client?.email && client.email_consent) {
      await sendEmail(client.email, 'Your policy renewal is coming up', `Hi ${client.full_name ?? ''}, your policy renews on ${policy.renewal_date}.`);
    }

    if (client?.phone && client.sms_consent) {
      await sendSMS(client.phone, `Shield Assurance: Your policy renews on ${policy.renewal_date}.`);
    }
  }

  return new Response('Renewal automation complete');
});
