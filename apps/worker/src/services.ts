export async function sendSms(input: { to: string; body: string }): Promise<{ providerId: string }> {
  if (!input.to) {
    throw new Error('SMS recipient is required.');
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    return { providerId: `sms-local-${Date.now()}` };
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: input.to,
      From: from,
      Body: input.body,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Twilio SMS failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { sid: string };
  return { providerId: payload.sid };
}

export async function sendWelcomeEmail(input: {
  to: string;
  accountName: string;
  dealTitle: string;
}): Promise<{ providerId: string }> {
  if (!input.to) {
    throw new Error('Email recipient is required.');
  }

  const sendGridApiKey = process.env.SENDGRID_API_KEY;
  const sendGridFrom = process.env.SENDGRID_FROM_EMAIL;

  if (!sendGridApiKey || !sendGridFrom) {
    return { providerId: `email-local-${Date.now()}` };
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sendGridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: sendGridFrom },
      subject: `Your policy is now bound: ${input.dealTitle}`,
      content: [
        {
          type: 'text/plain',
          value: `Hi, your policy for ${input.accountName} has been bound successfully.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`SendGrid email failed: ${response.status} ${response.statusText}`);
  }

  return {
    providerId: response.headers.get('x-message-id') ?? `email-${Date.now()}`,
  };
}
