import { resendConfiguration, sendResendEmail } from '@crm/shared/resend';
import { createHash } from 'node:crypto';

export async function sendAccountMail(to: string, subject: string, body: string, token: string): Promise<void> {
  await sendResendEmail({
    to, subject, body, purpose: 'service',
    requestId: `account-security:${createHash('sha256').update(token).digest('hex')}`,
  }, resendConfiguration(process.env));
}
