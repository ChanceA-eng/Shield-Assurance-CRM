export interface EmailReceipt {
  msg_id: string;
  request_key?: string;
  status: string;
  subject?: string | null;
  last_event_time?: string | null;
  delivered_at?: string | null;
  first_open_at?: string | null;
  last_open_at?: string | null;
}

export function receiptForMessage(metadata: Record<string, unknown> | null | undefined, receipts: EmailReceipt[]): EmailReceipt | undefined {
  if (!metadata) return undefined;
  const request = typeof metadata.request_id === 'string' ? metadata.request_id
    : typeof metadata.scheduled_message_id === 'string' ? `scheduled:${metadata.scheduled_message_id}`
      : typeof metadata.outbox_id === 'string' ? `outreach:${metadata.outbox_id}` : undefined;
  return receipts.find((receipt) => (request !== undefined && receipt.request_key === request)
    || (typeof metadata.provider_id === 'string' && receipt.msg_id === metadata.provider_id));
}

export function receiptLabel(status: string): string {
  switch (status) {
    case 'accepted_by_provider': return 'Accepted';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'delivery_delayed': return 'Delivery delayed';
    case 'bounced': return 'Bounced';
    case 'complained': return 'Marked as spam';
    case 'suppressed': return 'Blocked';
    case 'failed': return 'Failed';
    case 'acceptance_unknown': return 'Send unconfirmed - do not resend';
    default: return 'Delivery unconfirmed';
  }
}
