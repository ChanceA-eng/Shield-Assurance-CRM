import { test, expect, leadId } from './workspace-fixtures';

const lead = {
  id: leadId, full_name: 'Campaign fixture contractor', email: 'fixture@example.invalid',
  company: 'Fixture business', status: 'new', account_id: null,
};

function response(ready = true) {
  return {
    campaigns: [],
    eligibleLeads: [lead],
    configuration: {
      ready, apiKeyConfigured: ready, webhookSecretConfigured: ready,
      unsubscribeConfigured: ready, senderDomainsConfigured: ready,
      issues: ready ? [] : ['Set INSTANTLY_API_KEY in the web deployment environment.'],
    },
    senderDomains: ready ? ['prospecting.example'] : [],
  };
}

test('deferred campaign page preserves history without technical setup instructions', async ({ page }) => {
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/instantly/campaigns', async (route) => {
    await waiting;
    await route.fulfill({ json: response(false) });
  });
  await page.goto('/outreach/campaigns', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
  await expect(page.getByText('Loading campaign history...', { exact: true })).toBeVisible();
  await expect(page.getByText('Setup required', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText('No campaigns have been staged.', { exact: true })).toBeVisible();
  await expect(page.getByText('Instantly', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Campaigns deferred', exact: true })).toBeVisible();
  await expect(page.getByText('Setup required', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Set INSTANTLY_API_KEY in the web deployment environment.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Cold campaigns use dedicated Instantly mailboxes/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create paused campaign', exact: true })).toHaveCount(0);
});

test('deferring campaigns removes draft, staging and activation controls without provider operations', async ({ page }) => {
  let creates = 0;
  let operations = 0;
  await page.route('**/api/instantly/campaigns', async (route) => {
    if (route.request().method() === 'POST') creates++;
    await route.fulfill({ json: response() });
  });
  await page.route(`**/api/leads/${leadId}/draft-outreach`, (route) => route.fulfill({
    json: { subject: 'Fixture subject', body: 'A grounded fixture message for the business owner.', cited_signals: ['Fixture business'] },
  }));
  await page.route('**/api/instantly/campaigns/*', async (route) => {
    operations++;
    await route.fulfill({ json: {} });
  });
  await page.goto('/outreach/campaigns', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Generate AI drafts', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Campaign name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Dedicated sender mailboxes', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create paused campaign', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(creates).toBe(0);
  expect(operations).toBe(0);
});

test('active campaigns retain confirmed pausing while deferred campaigns cannot resume', async ({ page }) => {
  let operations = 0;
  await page.route('**/api/instantly/campaigns', (route) => route.fulfill({
    json: { ...response(), campaigns: [{
      id: 'fixture-campaign', name: 'Active fixture', status: 'active', daily_limit: 5,
      sender_accounts: ['sender@prospecting.example'], last_error: null, created_at: new Date().toISOString(),
    }] },
  }));
  await page.route('**/api/instantly/campaigns/*', async (route) => {
    operations++;
    await route.fulfill({ json: {} });
  });
  await page.goto('/outreach/campaigns', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(operations).toBe(0);
});

test('live campaign API reads installed schema and rejects unauthenticated webhooks', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const campaigns = await context.request.get('/api/instantly/campaigns');
  expect(campaigns.status(), await campaigns.text()).toBe(200);
  const data = await campaigns.json();
  expect(Array.isArray(data.campaigns)).toBe(true);
  expect(Array.isArray(data.eligibleLeads)).toBe(true);
  expect(Array.isArray(data.configuration.issues)).toBe(true);
  expect(typeof data.configuration.ready).toBe('boolean');
  const webhook = await context.request.post('/api/instantly/webhook', {
    data: { event_type: 'lead_interested', campaign_id: 'unauthorized-fixture' },
  });
  expect(webhook.status()).toBe(401);
});
