'use client';

import ScheduleSend from './ScheduleSend';
import type { SelectedSalesTemplate } from './SalesTemplatePicker';
import type { EmailDocument } from '@crm/shared';

export default function LeadScheduleSend({ leadId, ...props }: {
  leadId: string; subject: string; body: string; disabled: boolean;
  onScheduled: () => void; onBusy: (busy: boolean) => void;
  template?: SelectedSalesTemplate | null;
  emailProvider?: 'default' | 'gmail';
  replySelected?: boolean;
  bodyDocument?: EmailDocument;
}): JSX.Element {
  return <ScheduleSend key={leadId} {...props} conversationKey={`lead:${leadId}`} />;
}
