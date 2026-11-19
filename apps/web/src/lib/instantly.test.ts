import { afterEach, expect, it, vi } from 'vitest';
import {
  addInstantlyBlocklistEntry,
  addInstantlyLeads,
  campaignRequestBody,
  createInstantlyCampaign,
  createInstantlyWebhook,
  leadRequestBody,
  type InstantlyCampaignInput,
  type InstantlyLeadInput,
} from './instantly';

const campaign: InstantlyCampaignInput = {
  name: 'Test campaign',
  senderAccounts: ['producer@prospecting.example'],
  dailyLimit: 5,
  steps: [{ subject: '{{crm_personalized_subject}}', body: '{{crm_personalized_body}}', delay_days: 0 }],
};

const lead: InstantlyLeadInput = {
  email: 'lead@example.test',
  firstName: 'Alex',
  lastName: 'Example',
  companyName: 'Contractor',
  phone: null,
  website: null,
  personalizedSubject: 'A grounded introduction',
  personalizedBody: 'First line\nSecond <line>',
  unsubscribeUrl: 'https://crm.example.test/api/email/unsubscribe?token=sample',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('builds a paused single-step campaign with an escaped postal footer and reply stops', () => {
  const body = campaignRequestBody(campaign, '123 Main <Suite 5>');
  const sequence = body.sequences as Array<{ steps: Array<{ variants: Array<{ subject: string; body: string }> }> }>;
  expect(sequence[0].steps[0].variants[0]).toMatchObject({
    subject: '{{crm_personalized_subject}}',
    body: expect.stringContaining('123 Main &lt;Suite 5&gt;'),
  });
  expect(body).toMatchObject({
    email_list: campaign.senderAccounts,
    daily_limit: 5,
    daily_max_leads: 5,
    stop_on_reply: true,
    stop_on_auto_reply: true,
    insert_unsubscribe_header: true,
  });
  expect(body).not.toHaveProperty('activate');
});

it('escapes reviewed personalized content and includes its signed unsubscribe link', () => {
  expect(leadRequestBody(lead)).toMatchObject({
    email: lead.email,
    personalization: lead.personalizedBody,
    custom_variables: {
      crm_personalized_subject: lead.personalizedSubject,
      crm_personalized_body: 'First line<br/>Second &lt;line&gt;',
      crm_unsubscribe_url: lead.unsubscribeUrl,
    },
  });
});

it('sends exact Instantly requests and treats duplicate blocklist entries as idempotent', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'test-api-key');
  vi.stubEnv('INSTANTLY_WEBHOOK_SECRET', 'a'.repeat(40));
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: 'provider-campaign' }))
    .mockResolvedValueOnce(Response.json({ id: 'provider-webhook' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok' }))
    .mockResolvedValueOnce(new Response(null, { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(createInstantlyCampaign(campaign, '123 Main St')).resolves.toBe('provider-campaign');
  await expect(createInstantlyWebhook('provider-campaign', 'https://crm.example.test/api/instantly/webhook'))
    .resolves.toBe('provider-webhook');
  await expect(addInstantlyLeads('provider-campaign', [lead])).resolves.toBeUndefined();
  await expect(addInstantlyBlocklistEntry('LEAD@example.test')).resolves.toBeUndefined();

  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.instantly.ai/api/v2/campaigns');
  expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
    campaign_id: 'provider-campaign',
    leads: [{ email: lead.email }],
  });
  expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ bl_value: 'lead@example.test' });
});

it('does not retry or report success when provider acceptance is ambiguous', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'test-api-key');
  vi.stubEnv('INSTANTLY_WEBHOOK_SECRET', 'a'.repeat(40));
  const fetchMock = vi.fn().mockRejectedValue(new Error('network timeout'));
  vi.stubGlobal('fetch', fetchMock);

  await expect(createInstantlyCampaign(campaign, '123 Main St')).rejects.toMatchObject({ status: null });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
