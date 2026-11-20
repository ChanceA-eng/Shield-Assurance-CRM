import { resendConfiguration, resendConfigured, sendResendEmail } from '@crm/shared/resend';
import { createHash } from 'node:crypto';

export function accountMailReady(): boolean {
  return resendConfigured(resendConfiguration(process.env));
}

export async function sendAccountMail(to: string, subject: string, body: string, token: string): Promise<void> {
  await sendResendEmail({
    to, subject, body, purpose: 'service',
    requestId: `account-security:${createHash('sha256').update(token).digest('hex')}`,
  }, resendConfiguration(process.env));
}

export async function sendTeamInviteMail(to: string, redirect: string, token: string, type: 'invite' | 'recovery' = 'invite'): Promise<void> {
  const link = new URL(redirect);
  link.hash = new URLSearchParams({ type: 'invite', token_hash: token, ...(type === 'recovery' ? { proof: 'recovery' } : {}) }).toString();
  await sendAccountMail(to, 'Join your team in Shield CRM',
    `Set up your Shield CRM account:\n\n${link.href}\n\nIf you were not expecting this invitation, you can ignore it.`, token);
}
