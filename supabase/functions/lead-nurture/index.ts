import { supabase } from '../_shared/supabaseClient.ts';
import { sendEmail, sendSMS } from '../_shared/messaging.ts';

Deno.serve(async (request) => {
  const body = await request.json().catch(() => ({}));
  const lead = body.record ?? body;
  const leadId = lead.id as string | undefined;
  const status = (lead.stage ?? lead.status ?? 'new') as string;
  const clientId = (lead.client_id ?? lead.clientId ?? null) as string | null;

  let subject = '';
  let message = '';

  switch (status) {
    case 'new':
      subject = 'Thanks for reaching out';
      message = 'We received your inquiry and will contact you shortly.';
      break;
    case 'quoted':
      subject = 'Your insurance quote';
      message = 'Here is your quote. Let us know if you have questions.';
      break;
    case 'won':
      subject = 'Welcome to Shield Assurance';
      message = "We're excited to have you onboard.";
      break;
    case 'lost':
      subject = 'Thank you for your time';
      message = "We're sorry we couldn't work together.";
      break;
    default:
      subject = 'Lead update';
      message = `Lead updated to ${status}.`;
      break;
  }

  const client = clientId
    ? (await supabase.from('clients').select('id,full_name,email,phone,email_consent,sms_consent').eq('id', clientId).maybeSingle()).data
    : null;

  if (client?.email && client.email_consent) {
    await sendEmail(client.email, subject, message);
  }

  if (client?.phone && client.sms_consent) {
    await sendSMS(client.phone, message);
  }

  if (clientId) {
    await supabase.from('communication_log').insert({
      client_id: clientId,
      channel: 'in_app',
      direction: 'outbound',
      subject,
      body: message,
      automation_type: 'lead',
    });
  }

  return new Response(JSON.stringify({ ok: true, leadId, status }), { headers: { 'Content-Type': 'application/json' } });
});
