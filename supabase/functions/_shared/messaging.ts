export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = Deno.env.get('SENDGRID_API_KEY');
  const fromEmail = Deno.env.get('SENDGRID_FROM_EMAIL');

  if (!apiKey || !fromEmail) {
    console.log('Email skipped: missing SendGrid configuration', { to, subject, body });
    return;
  }

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: fromEmail },
      content: [{ type: 'text/plain', value: body }],
    }),
  });
}

export async function sendSMS(to: string, body: string): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    console.log('SMS skipped: missing Twilio configuration', { to, body });
    return;
  }

  const credentials = btoa(`${accountSid}:${authToken}`);
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', fromNumber);
  form.set('Body', body);

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
}
