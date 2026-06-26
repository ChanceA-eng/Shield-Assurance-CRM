import { describe, expect, it } from 'vitest';
import { sendSms, sendWelcomeEmail } from './services.js';

describe('worker adapters', () => {
  it('returns fallback ids when provider credentials are absent', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;

    const sms = await sendSms({ to: '+15551234567', body: 'test' });
    const email = await sendWelcomeEmail({
      to: 'client@example.com',
      accountName: 'Northstar',
      dealTitle: 'Auto Policy',
    });

    expect(sms.providerId).toContain('sms-local');
    expect(email.providerId).toContain('email-local');
  });
});
