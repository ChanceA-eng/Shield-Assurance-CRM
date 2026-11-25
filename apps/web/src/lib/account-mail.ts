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

export async function sendTeamInviteMail(to: string, redirect: string, member: string, challenge: string): Promise<void> {
  const link = new URL(redirect);
  link.hash = new URLSearchParams({ type: 'invite', member, challenge }).toString();
  await sendResendEmail({
    to, subject: 'Join your team in Shield CRM',
    body: 'Set up your Shield CRM account. This link expires in 24 hours and can be used once. A replacement link invalidates this one.\n\nIf you were not expecting this invitation, you can ignore it.',
    purpose: 'service',
    requestId: `account-security:${createHash('sha256').update(challenge).digest('hex')}`,
    emailDesign: {
      layout: 'welcome', brand_name: 'Shield Assurance', accent_color: '#087ca1', background_color: '#edf2f7',
      logo_url: '', image_url: '', image_alt: '', heading: 'Join your team',
      button_label: 'Set up your account', button_url: link.href,
    },
  }, resendConfiguration(process.env));
}
