import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  addBlocklistEntry: vi.fn(),
}));

vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServerClient: mocks.getDb }));
vi.mock('../../../../lib/instantly', () => ({ addInstantlyBlocklistEntry: mocks.addBlocklistEntry }));

import { POST } from './route';

const secret = 'a'.repeat(40);
let rpc: ReturnType<typeof vi.fn>;
let from: ReturnType<typeof vi.fn>;

function database(): SupabaseClient {
  rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: table === 'instantly_campaigns' ? { id: 'local-campaign' } : { lead_id: 'local-lead' },
        error: null,
      })),
    };
    return query;
  });
  return { from, rpc } as unknown as SupabaseClient;
}

function request(event: Record<string, unknown>, authorization = `Bearer ${secret}`): NextRequest {
  return new NextRequest('https://crm.example.test/api/instantly/webhook', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
}

beforeEach(() => {
  vi.stubEnv('INSTANTLY_WEBHOOK_SECRET', secret);
  mocks.getDb.mockReturnValue(database());
  mocks.addBlocklistEntry.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('rejects unauthorized events before accessing CRM data', async () => {
  const response = await POST(request({ event_type: 'lead_interested', campaign_id: 'provider-campaign' }, 'Bearer wrong'));
  expect(response.status).toBe(401);
  expect(mocks.getDb).not.toHaveBeenCalled();
});

it('records generic replies without treating them as warm-prospect alerts', async () => {
  const response = await POST(request({
    event_type: 'reply_received',
    campaign_id: 'provider-campaign',
    lead_email: 'Lead@example.test',
    email_account: 'sender@prospecting.example',
    reply_subject: 'Re: quote',
    reply_text: 'We may be interested. Please send more information.',
    timestamp: new Date().toISOString(),
    event_id: 'event-1',
  }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('record_instantly_campaign_event', expect.objectContaining({
    p_event_type: 'reply_received',
    p_email: 'lead@example.test',
    p_body: 'We may be interested. Please send more information.',
    p_campaign_id: 'local-campaign',
    p_lead_id: 'local-lead',
  }));
  expect(mocks.addBlocklistEntry).not.toHaveBeenCalled();
});

it('adds explicit email opt-out replies to Instantly suppression', async () => {
  const response = await POST(request({
    event_type: 'reply_received',
    campaign_id: 'provider-campaign',
    lead_email: 'lead@example.test',
    reply_text: 'Please remove me.',
    event_id: 'event-opt-out',
  }));
  expect(response.status).toBe(200);
  expect(mocks.addBlocklistEntry).toHaveBeenCalledWith('lead@example.test');
});

it('adds an unsubscribed address to Instantly suppression after recording it', async () => {
  const response = await POST(request({
    event_type: 'lead_unsubscribed',
    campaign_id: 'provider-campaign',
    lead_email: 'lead@example.test',
    event_id: 'event-2',
  }));
  expect(response.status).toBe(200);
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.addBlocklistEntry.mock.invocationCallOrder[0]);
  expect(mocks.addBlocklistEntry).toHaveBeenCalledWith('lead@example.test');
});

it('rejects malformed payloads without recording them', async () => {
  const response = await POST(new NextRequest('https://crm.example.test/api/instantly/webhook', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: '{',
  }));
  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
