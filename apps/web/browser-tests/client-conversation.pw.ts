import { test, expect, leadId } from './workspace-fixtures';

test('client thread combines incoming messages and exact delivery/open receipts with one composer', async ({ page, data }) => {
  const outboundId = 'c6842aab-e62d-4c28-9c58-c9046b7ef657';
  const inboundId = 'ea461bce-e887-4a2d-a370-1849a8b76c2a';
  const created = '2026-11-05T02:00:00Z';
  let draftRequest: unknown;
  let messages: Array<Record<string, unknown>> = [
    { id: outboundId, channel: 'email', direction: 'outbound', subject: 'Policy question', body: 'Your requested policy information.',
      sent_at: created, metadata: { request_id: 'test-request', delivery_status: 'accepted_by_provider' } },
    { id: inboundId, channel: 'email', direction: 'inbound', subject: 'Re: Policy question', body: 'Can you **call me tomorrow**?\r\n\r\n\r\nThanks,\u00a0\r\nClient\r\n\r\nOn Wed, Nov 4, 2026 at 8:39 PM Chance Amani <camani@shield-assurance.com>\r\nwrote:\r\n> Your requested policy information.',
      sent_at: '2026-11-05T02:05:00Z', read_at: created },
    { id: 'legacy', channel: 'email', direction: 'outbound', subject: 'Policy question', body: 'Legacy message without send identity.',
      sent_at: '2026-11-05T01:00:00Z', metadata: { delivery_status: 'accepted_by_provider' } },
  ];
  await page.route('**/api/clients/*/workspace?**', async (route) => {
    const url = new URL(route.request().url());
    const result = data.handle(url, route.request().method(), {});
    await route.fulfill({ json: { ...result.json as Record<string, unknown>, client: { ...data.account, email: 'client@example.invalid', email_consent: true } } });
  });
  await page.route('**/api/communication-log?**', async (route) => { await route.fulfill({ json: messages }); });
  await page.route('**/api/communication-log/delivery?**', async (route) => {
    await route.fulfill({ json: [{ msg_id: 'real-provider-id', request_key: 'test-request', status: 'delivered',
      delivered_at: '2026-11-05T02:00:01Z', first_open_at: '2026-11-05T02:01:00Z', last_open_at: '2026-11-05T02:03:00Z' }] });
  });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  const toolbar = drawer.getByLabel('Conversation toolbar');
  await expect(toolbar.getByRole('heading', { name: data.account.full_name, exact: true })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Client Conversation', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole('link', { name: `Call ${data.account.full_name}`, exact: true })).toHaveAttribute('href', `tel:${data.account.phone}`);
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(36);
  const nameBounds = await toolbar.getByRole('heading').boundingBox();
  const channelBounds = await toolbar.getByRole('combobox').boundingBox();
  expect(Math.abs(nameBounds!.y + nameBounds!.height / 2 - channelBounds!.y - channelBounds!.height / 2)).toBeLessThan(2);
  await expect(drawer.getByRole('article', { name: 'Incoming message' })).toContainText('Can you call me tomorrow?');
  await expect(drawer.getByRole('button', { name: 'Delivery', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Conversation', exact: true })).toHaveCount(0);
  const outbound = drawer.getByRole('article', { name: 'Outgoing message' }).filter({ hasText: 'Your requested policy information.' });
  await expect(outbound).toContainText('Open detected');
  await expect(outbound).toContainText('Last opened');
  await expect(outbound).not.toContainText('Accepted');
  const legacy = drawer.getByRole('article', { name: 'Outgoing message' }).filter({ hasText: 'Legacy message' });
  await expect(legacy).toContainText('No open recorded');
  await expect(legacy).not.toContainText('Open detected');
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveCount(1);
  await expect(drawer.getByRole('button', { name: 'Send Now', exact: true })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sales templates', exact: true }).getByRole('combobox', { name: 'Message template' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer.getByRole('button', { name: 'Schedule send', exact: true })).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Message body' }).fill('Create a relevant, respectful follow up.');
  await drawer.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  const draftPanel = page.getByRole('dialog', { name: 'Draft with AI', exact: true });
  const dossierOptIn = draftPanel.getByRole('checkbox', { name: 'Include current confirmed dossier findings in this AI draft only' });
  await expect(dossierOptIn).not.toBeChecked();
  await page.route('**/api/ai/draft-message**', async (route) => {
    draftRequest = route.request().postDataJSON();
    await route.fulfill({ json: {
      ok: true, subject: 'Confirmed priorities', text: 'I can help review the coverage lines you mentioned.',
      cited_signals: ['Agent-confirmed dossier finding'], dossier_requested: true,
      dossier_facts_included: ['Prospect-stated priorities'],
    } });
  });
  await dossierOptIn.check();
  await draftPanel.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await expect.poll(() => draftRequest).toMatchObject({ include_dossier: true });
  await expect(draftPanel.getByRole('status').filter({ hasText: 'Dossier findings included in the most recent draft: Prospect-stated priorities' })).toBeVisible();
  await expect(draftPanel.getByText(/Draft grounding: Agent-confirmed dossier finding/)).toBeVisible();
  await page.keyboard.press('Escape');

  const incoming = drawer.getByRole('article', { name: 'Incoming message' });
  await expect(incoming.locator('[data-conversation-message]')).toHaveAttribute('data-conversation-message', 'inbound');
  await expect(incoming.locator('[data-conversation-message]')).toHaveClass(/bg-cui-light/);
  await expect(outbound.locator('[data-conversation-message]')).toHaveClass(/border-cui-primary/);
  await expect(incoming.locator('strong')).toHaveText('call me tomorrow');
  await expect(incoming).not.toContainText('**');
  await expect(incoming.getByText('> Your requested policy information.', { exact: true })).toBeHidden();
  await incoming.getByText('Show quoted email', { exact: true }).click();
  await expect(incoming.getByText(/Chance Amani/)).toBeVisible();
  await incoming.getByText('Show quoted email', { exact: true }).click();
  const compact = await drawer.boundingBox();
  await drawer.getByRole('textbox', { name: 'Message body' }).fill('Draft survives expansion.');
  await drawer.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Collapse', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const expanded = await drawer.boundingBox();
  expect(expanded!.width).toBeGreaterThan(compact!.width);
  expect(expanded!.width).toBe(page.viewportSize()!.width);
  const history = drawer.getByRole('log', { name: 'Message history' });
  const composer = drawer.getByRole('region', { name: 'Message composer' });
  const historyBounds = await history.boundingBox();
  const composerBounds = await composer.boundingBox();
  expect(historyBounds!.width).toBeGreaterThan(expanded!.width * 0.6);
  expect(historyBounds!.height).toBeGreaterThan(expanded!.height * 0.5);
  expect(Math.abs(composerBounds!.x - historyBounds!.x)).toBeLessThan(2);
  expect(composerBounds!.y).toBeGreaterThanOrEqual(historyBounds!.y + historyBounds!.height);
  const incomingCard = await incoming.locator('div').first().boundingBox();
  const outgoingCard = await outbound.locator('div').first().boundingBox();
  expect(incomingCard!.x).toBeLessThan(outgoingCard!.x);
  expect(outgoingCard!.x + outgoingCard!.width).toBeGreaterThan(incomingCard!.x + incomingCard!.width);
  await expect(incoming.getByText(/Chance Amani/)).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('expanded-conversation.png') });
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveValue('Draft survives expansion.');
  await drawer.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  expect((await history.boundingBox())!.height).toBe(historyBounds!.height);
  await expect(drawer.getByRole('button', { name: 'Send Now', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveValue('Draft survives expansion.');
  await drawer.getByRole('textbox', { name: 'Message body' }).fill('Draft survives incoming reply.');

  messages = [...messages, { id: 'new-reply', channel: 'email', direction: 'inbound', subject: 'Another reply',
    body: 'New reply after refresh.', sent_at: '2026-11-05T02:10:00Z', read_at: created }];
  await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
  await expect(drawer.getByText('New reply after refresh.', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveValue('Draft survives incoming reply.');

  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toBeInViewport();
  await expect(drawer.getByRole('button', { name: 'Send Now', exact: true })).toBeInViewport();
  const bounds = await drawer.boundingBox();
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(36);
  expect((await toolbar.getByRole('button', { name: 'Close', exact: true }).boundingBox())!.x).toBeLessThan(390);
  await expect(toolbar.getByRole('link', { name: `Call ${data.account.full_name}`, exact: true })).toBeInViewport();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  expect((await drawer.getByRole('log', { name: 'Message history' }).boundingBox())!.height).toBeGreaterThan(300);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toBeHidden();
});

test('client contact shortcuts open email and calling apps without recording a send or completed call', async ({ page, data }) => {
  const email = 'contact@example.invalid';
  const phone = data.account.phone;
  if (!phone) throw new Error('Expected the client phone fixture.');
  await page.route('**/api/clients/*/workspace?**', async (route) => {
    const result = data.handle(new URL(route.request().url()), route.request().method(), {});
    await route.fulfill({ json: { ...result.json as Record<string, unknown>, client: { ...data.account, email } } });
  });
  await page.goto(`/clients/${data.account.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: email, exact: true })).toHaveCount(2);
  for (const link of await main.getByRole('link', { name: email, exact: true }).all()) {
    await expect(link).toHaveAttribute('href', `mailto:${email}`);
  }
  await expect(main.getByRole('link', { name: phone, exact: true })).toHaveCount(2);
  for (const link of await main.getByRole('link', { name: phone, exact: true }).all()) {
    await expect(link).toHaveAttribute('href', `tel:${phone}`);
  }
  await main.getByRole('button', { name: 'Communication', exact: true }).click();
  const toolbar = page.getByLabel('Conversation toolbar');
  await expect(toolbar.getByRole('link', { name: `Call ${data.account.full_name}`, exact: true })).toHaveAttribute('href', `tel:${data.account.phone}`);
  await page.evaluate(() => {
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href^="tel:"], a[href^="mailto:"]')) event.preventDefault();
    });
  });
  const writes: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.method()); });
  await toolbar.getByRole('link', { name: `Call ${data.account.full_name}`, exact: true }).click();
  expect(writes).toEqual([]);
});

test('client without contact details has no empty contact links and calling is unavailable', async ({ page, data }) => {
  await page.route('**/api/clients/*/workspace?**', async (route) => {
    const result = data.handle(new URL(route.request().url()), route.request().method(), {});
    await route.fulfill({ json: { ...result.json as Record<string, unknown>, client: { ...data.account, email: null, phone: null } } });
  });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  await expect(drawer.getByRole('button', { name: 'Call unavailable: no phone number', exact: true })).toBeDisabled();
  await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0);
});

test('inbox and lead conversations show real opens and readable email without provider banners', async ({ page, data }) => {
  const message = {
    id: 'c6842aab-e62d-4c28-9c58-c9046b7ef657', client_id: null, channel: 'email', direction: 'outbound',
    subject: 'Policy information', body: 'Hello,\n\nYour requested information.\n\nOn Wednesday, Agent wrote:\n> Earlier email',
    sent_at: '2026-11-05T02:00:00Z', read_at: null,
    metadata: { request_id: 'receipt-request', delivery_status: 'accepted_by_provider', provider: 'resend' },
  };
  let latestBody = message.body;
  await page.route('**/api/communication/inbox?**', async (route) => {
    await route.fulfill({ json: { conversations: [{
      key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
      email: data.lead.email, phone: null, address: data.lead.email, href: `/leads?lead=${leadId}`, can_email: true,
      last_subject: message.subject, last_snippet: 'Your requested information.', last_direction: 'outbound',
      last_channel: 'email', last_at: message.sent_at, unread: 0, total: 1,
    }], total: 1 } });
  });
  await page.route('**/api/communication-log?**', async (route) => { await route.fulfill({ json: [{ ...message, body: latestBody }] }); });
  await page.route('**/api/communication-log/delivery?**', async (route) => {
    await route.fulfill({ json: [{ msg_id: 'provider-receipt', request_key: 'receipt-request', status: 'delivered',
      first_open_at: '2026-11-05T02:01:00Z', last_open_at: '2026-11-05T02:03:00Z' }] });
  });
  await page.goto(`/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
  await expect(page.getByText('Open detected', { exact: false })).toBeVisible();
  await expect(page.getByText('Last opened', { exact: false })).toBeVisible();
  await expect(page.getByText(/Accepted by resend/i)).toHaveCount(0);
  await expect(page.getByText('Show quoted email', { exact: true })).toBeVisible();
  latestBody = 'Updated inbox message without pressing Refresh.';
  await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
  await expect(page.getByText(latestBody, { exact: true })).toBeVisible();
  latestBody = message.body;

  await page.route(`**/api/leads/${leadId}/conversation?**`, async (route) => {
    await route.fulfill({ json: { clientId: null, items: [{ ...message, body: latestBody }], nextOffset: null } });
  });
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(page.getByText('Open detected', { exact: false })).toBeVisible();
  await expect(page.getByText(/Accepted by resend/i)).toHaveCount(0);
  await expect(page.getByText('Show quoted email', { exact: true })).toBeVisible();
  latestBody = 'Updated lead message without pressing Refresh.';
  await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
  await expect(page.getByText(latestBody, { exact: true })).toBeVisible();
  expect(data.unexpected).toEqual([]);
});

test('client thread polls for new messages without realtime or manual refresh', async ({ page, data }) => {
  let received = false;
  await page.route('**/api/communication-log?**', async (route) => {
    await route.fulfill({ json: received ? [{
      id: 'polling-reply', channel: 'email', direction: 'inbound', subject: 'Polling reply',
      body: 'Automatically recovered the new reply.', sent_at: '2026-11-05T05:00:00Z', read_at: '2026-11-05T05:01:00Z',
    }] : [] });
  });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  await expect(drawer.getByRole('status')).toHaveCount(0);
  await drawer.getByRole('textbox', { name: 'Message body' }).fill('Keep my draft while polling.');
  received = true;
  await expect(drawer.getByText('Automatically recovered the new reply.', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveValue('Keep my draft while polling.');
});

test('client thread surfaces refresh failure and retries without losing the draft', async ({ page, data }) => {
  let fail = true;
  await page.route('**/api/communication-log?**', async (route) => {
    await route.fulfill(fail ? { status: 503, json: { message: 'Replies temporarily unavailable.' } } : { json: [] });
  });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  await expect(drawer.getByRole('alert')).toContainText('Replies temporarily unavailable.');
  await drawer.getByRole('textbox', { name: 'Message body' }).fill('Keep this draft.');
  fail = false;
  await drawer.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect(drawer.getByRole('textbox', { name: 'Message body' })).toHaveValue('Keep this draft.');
});

test('completed reply tasks disappear automatically from global and record task lists', async ({ page, data }) => {
  const task = data.tasks[0];
  if (!task) throw new Error('Expected the task fixture.');
  task.subject = 'Reply to client email';
  data.tasks.push({ ...task, id: '98b2f706-7a69-498f-a0cb-73750479c686', subject: 'Unrelated renewal follow-up' });
  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'Complete Reply to client email', exact: true })).toBeVisible();
  task.status = 'completed';
  task.updated_at = data.stamp();
  await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
  await expect(page.getByRole('button', { name: 'Complete Reply to client email', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Complete Unrelated renewal follow-up', exact: true })).toBeVisible();
  for (const kind of ['client', 'lead'] as const) {
    task.status = 'open';
    task.related_type = kind;
    task.related_id = kind === 'client' ? data.account.id : leadId;
    task.account_id = kind === 'client' ? data.account.id : null;
    task.updated_at = data.stamp();
    await page.goto(kind === 'client' ? `/clients/${data.account.id}?tab=tasks` : `/leads?lead=${leadId}`);
    if (kind === 'lead') await page.getByRole('button', { name: /^Tasks \(/ }).click();
    await expect(page.getByRole('button', { name: 'Complete Reply to client email', exact: true })).toBeVisible();
    task.status = 'completed';
    task.updated_at = data.stamp();
    await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
    await expect(page.getByRole('button', { name: 'Complete Reply to client email', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Completed \(/ }).click();
    await expect(page.getByRole('button', { name: 'Reopen Reply to client email', exact: true })).toBeVisible();
  }
});
