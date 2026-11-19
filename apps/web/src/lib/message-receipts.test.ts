import { describe, expect, it } from 'vitest';
import { emailReceiptTimes, strongestDeliveryEvent } from './email-delivery-status';
import { receiptForMessage, receiptLabel } from './message-receipts';

describe('honest inline email receipts', () => {
  const receipts = [
    { msg_id: 'provider-one', request_key: 'request-one', status: 'delivered' },
    { msg_id: 'provider-two', request_key: 'scheduled:two', status: 'bounced' },
  ];
  it('links only exact send identities, never a repeated subject or recipient', () => {
    expect(receiptForMessage({ request_id: 'request-one' }, receipts)).toBe(receipts[0]);
    expect(receiptForMessage({ provider_id: 'provider-two' }, receipts)).toBe(receipts[1]);
    expect(receiptForMessage({ scheduled_message_id: 'two' }, receipts)).toBe(receipts[1]);
    expect(receiptForMessage({ subject: 'Same subject', to: 'same@example.invalid' }, receipts)).toBeUndefined();
    expect(receiptForMessage(null, receipts)).toBeUndefined();
  });
  it('keeps open events independent from delivery or failure state', () => {
    const events = [
      { type: 'email.opened', occurred_at: '2026-11-05T02:00:00Z' },
      { type: 'email.bounced', occurred_at: '2026-11-05T00:01:00Z' },
    ];
    expect(strongestDeliveryEvent(events)?.type).toBe('email.bounced');
    expect(emailReceiptTimes(events)).toEqual({ first_open_at: '2026-11-05T02:00:00Z', last_open_at: '2026-11-05T02:00:00Z', delivered_at: null });
    expect(strongestDeliveryEvent([events[0]!])).toBeUndefined();
  });
  it('never invents opens or promotes provider acceptance to delivery', () => {
    expect(emailReceiptTimes([])).toEqual({ delivered_at: null, first_open_at: null, last_open_at: null });
    expect(receiptLabel('accepted_by_provider')).toBe('Accepted');
    expect(receiptLabel('')).toBe('Delivery unconfirmed');
    expect(receiptLabel('acceptance_unknown')).toContain('do not resend');
  });
});
