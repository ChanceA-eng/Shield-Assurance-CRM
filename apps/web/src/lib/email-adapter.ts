import { resendConfiguration, sendResendEmail, type ResendMessage } from '@crm/shared/resend';
import { agencyEnabled } from './agency-membership';

export type OutboundEmail = ResendMessage;
export type EmailProvider = 'resend';

export async function sendOutboundEmail(payload: OutboundEmail): Promise<EmailProvider> {
  if (agencyEnabled()) throw new Error('Agent mode requires an explicit authorized mailbox. Shared-provider fallback is disabled.');
  await sendResendEmail(payload, resendConfiguration(process.env));
  return 'resend';
}
