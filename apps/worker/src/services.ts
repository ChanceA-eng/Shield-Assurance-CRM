import { resendConfiguration, sendResendEmail } from '@crm/shared/resend';

export async function sendSms(input: { to: string; body: string }): Promise<{ providerId: string }> {
  if (!input.to) {
    throw new Error('SMS recipient is required.');
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    throw new Error('Twilio is not configured; no SMS was sent.');
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
  requestId?: string;
}): Promise<{ providerId: string }> {
  if (!input.to) {
    throw new Error('Email recipient is required.');
  }

  if (!input.requestId) throw new Error('A stable workflow send ID is required for Resend.');
  return sendResendEmail({
    to: input.to, subject: `Your policy is now bound: ${input.dealTitle}`,
    body: `Hi, your policy for ${input.accountName} has been bound successfully.`,
    requestId: input.requestId, purpose: 'service',
  }, resendConfiguration(process.env));
}
