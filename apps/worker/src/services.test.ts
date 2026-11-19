import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSms, sendWelcomeEmail } from './services.js';
import { sendResendEmail } from '@crm/shared/resend';

vi.mock('@crm/shared/resend', async (original) => ({
  ...await original<typeof import('@crm/shared/resend')>(), sendResendEmail: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('worker adapters', () => {
  it('uses the same Resend transport and stable request identity for policy welcomes', async () => {
    vi.mocked(sendResendEmail).mockResolvedValue({ providerId: 'resend-receipt' });
    expect(await sendWelcomeEmail({ to: 'client@example.invalid', accountName: 'Northstar',
      dealTitle: 'Auto Policy', requestId: 'deal-bound:one' })).toEqual({ providerId: 'resend-receipt' });
    expect(sendResendEmail).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'deal-bound:one', purpose: 'service', to: 'client@example.invalid',
    }), expect.anything());
  });
  it('never sends a retryable welcome without a stable request identity', async () => {
    await expect(sendWelcomeEmail({ to: 'client@example.invalid', accountName: 'Northstar', dealTitle: 'Auto Policy' })).rejects.toThrow('stable');
    expect(sendResendEmail).not.toHaveBeenCalled();
  });
  it('surfaces Resend failure without falling back to another provider', async () => {
    vi.mocked(sendResendEmail).mockRejectedValue(new Error('uncertain acceptance'));
    await expect(sendWelcomeEmail({ to: 'client@example.invalid', accountName: 'Northstar',
      dealTitle: 'Auto Policy', requestId: 'deal-bound:one' })).rejects.toThrow('uncertain acceptance');
    expect(sendResendEmail).toHaveBeenCalledTimes(1);
  });
  it('rejects SMS delivery when Twilio is not configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    await expect(sendSms({ to: '+15551234567', body: 'test' })).rejects.toThrow('Twilio is not configured');
  });
});
