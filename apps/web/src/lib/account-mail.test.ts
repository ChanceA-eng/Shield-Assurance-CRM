import { expect, it, vi } from 'vitest';
import { sendResendEmail } from '@crm/shared/resend';
import { emailDesignText, renderEmailHtml } from '@crm/shared';
import { sendTeamInviteMail } from './account-mail';

vi.mock('@crm/shared/resend', () => ({
  resendConfiguration: () => ({}),
  sendResendEmail: vi.fn(),
}));

it('sends a challenge-based CRM setup link without putting the challenge in the request key', async () => {
  const redirect = 'https://crm.example.invalid/auth/accept';
  const member = '11111111-1111-4111-8111-111111111111';
  const challenge = 'a'.repeat(43);
  await sendTeamInviteMail('new@example.invalid', redirect, member, challenge);
  const message = vi.mocked(sendResendEmail).mock.calls[0][0];
  expect(message).toMatchObject({ to: 'new@example.invalid', purpose: 'service' });
  expect(message.emailDesign?.button_label).toBe('Set up your account');
  expect(message.emailDesign?.button_url).toBe(`${redirect}#type=invite&member=${member}&challenge=${challenge}`);
  expect(message.body).toContain('expires in 24 hours');
  expect(message.requestId).not.toContain(challenge);
  expect(renderEmailHtml(message.body, message.emailDesign)).toContain(`href="${redirect}#type=invite&amp;member=${member}&amp;challenge=${challenge}"`);
  expect(emailDesignText(message.body, message.emailDesign)).toContain(`Set up your account: ${redirect}#type=invite&member=${member}&challenge=${challenge}`);
});
