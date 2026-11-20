import { expect, it, vi } from 'vitest';
import { sendResendEmail } from '@crm/shared/resend';
import { sendTeamInviteMail } from './account-mail';

vi.mock('@crm/shared/resend', () => ({
  resendConfiguration: () => ({}),
  sendResendEmail: vi.fn(),
}));

it('passes the direct CRM setup link to Resend without putting the OTP in the request key', async () => {
  const redirect = 'https://crm.example.invalid/auth/accept';
  const token = 'synthetic-invite-proof';
  await sendTeamInviteMail('new@example.invalid', redirect, token);
  const message = vi.mocked(sendResendEmail).mock.calls[0][0];
  expect(message).toMatchObject({ to: 'new@example.invalid', purpose: 'service' });
  expect(message.body).toContain(`${redirect}#type=invite&token_hash=${token}`);
  expect(message.requestId).not.toContain(token);
});
