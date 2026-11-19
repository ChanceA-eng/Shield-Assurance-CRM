import { test, expect, leadId } from './workspace-fixtures';

for (const surface of ['account', 'lead', 'inbox'] as const) {
  test(`${surface} personal Gmail is visible and routes the main Send action through Gmail`, async ({ page, data }) => {
    let sent: unknown;
    if (surface === 'account') {
      data.account.email = 'fixture@example.invalid';
      data.account.email_consent = true;
      await page.route(`**/api/clients/${data.account.id}/activities`, (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 201, json: { id: 'qa-gmail-send-activity' } }) : route.fallback());
    }
    await page.route('**/api/gmail', (route) => route.fulfill({ json: { default_provider: 'resend',
      connection: { email: 'qa@example.invalid', status: 'connected', sync_enabled: false } } }));
    await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
      key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
      email: data.lead.email, address: data.lead.email, can_email: true, total: 0, unread: 0,
    }] } }));
    await page.route('**/api/communication-log', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { id: 'qa-gmail-send', delivery: 'accepted_by_provider', provider: 'gmail' } });
    });
    await page.goto(surface === 'account' ? `/clients/${data.account.id}?tab=communication`
      : surface === 'lead' ? `/leads?lead=${leadId}&tab=conversation` : `/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
    const composer = page.locator('[data-message-composer="email"]');
    const sender = composer.getByRole('combobox', { name: 'Send from', exact: true });
    await expect(sender).toBeVisible();
    await expect(sender).toHaveValue('gmail');
    await expect(sender.locator('option[value="gmail"]')).toBeEnabled();
    await expect(sender.locator('option')).toHaveCount(2);
    await expect(sender.locator('option[value="default"]')).toHaveText('Agency email');
    await expect(composer.getByRole('link', { name: /Connect Gmail|Reconnect Gmail/ })).toHaveCount(0);
    await expect(composer.getByRole('button', { name: /Refresh Gmail status/ })).toHaveCount(0);
    await composer.getByLabel('Message subject', { exact: true }).fill('Requested coverage review');
    await composer.getByLabel('Message body', { exact: true }).fill('Synthetic QA draft; the send route is intercepted.');
    await composer.getByRole('button', { name: /^(Send|Send Now|Send email)$/ }).click();
    await expect.poll(() => sent).toMatchObject({ email_provider: 'gmail' });
    expect(data.unexpected).toEqual([]);
  });

  test(`${surface} uses chronological, progressively loaded history without scrolling the composer`, async ({ page, data }) => {
    let rows = Array.from({ length: 170 }, (_, index) => ({
      id: `message-${String(index).padStart(3, '0')}`, channel: 'email', direction: index % 2 ? 'inbound' : 'outbound',
      subject: `Coverage review ${index}`, body: `Message ${index}\nRequested coverage details.\nThank you for the update.`,
      sent_at: new Date(Date.UTC(2026, 10, 6, 0, index)).toISOString(), read_at: '2026-11-07T00:00:00Z',
    }));
    await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
      key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
      email: data.lead.email, address: data.lead.email, can_email: true, total: 170, unread: 0,
    }] } }));
    const response = (url: string): { items: typeof rows; nextOffset: number | null } => {
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
      const items = [...rows].reverse().slice(offset, offset + 100);
      return { items, nextOffset: offset + items.length < rows.length ? offset + items.length : null };
    };
    await page.route('**/api/communication-log?**', (route) => {
      const result = response(route.request().url());
      return route.fulfill({ json: result.items, headers: { 'X-Next-Offset': result.nextOffset === null ? '' : String(result.nextOffset) } });
    });
    await page.route(`**/api/leads/${leadId}/conversation?**`, (route) => route.fulfill({ json: { ...response(route.request().url()), clientId: null } }));
    await page.goto(surface === 'account' ? `/clients/${data.account.id}?tab=communication`
      : surface === 'lead' ? `/leads?lead=${leadId}&tab=conversation` : `/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
    const history = page.locator('[data-conversation-history]');
    const composer = page.locator('[data-message-composer="email"]');
    const latest = history.locator('[data-history-id="message-169"]');
    await expect(latest).toBeVisible();
    await expect(history.locator('[data-history-id]')).toHaveCount(100);
    const ids = await history.locator('[data-history-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-history-id')));
    expect(ids).toEqual([...ids].sort());
    await expect.poll(async () => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(4);
    await composer.getByLabel('Message body', { exact: true }).fill('Keep this draft while reading history.');
    const fixedBefore = await composer.boundingBox();
    await history.evaluate((node) => { node.scrollTop = 0; });
    await expect.poll(async () => history.evaluate((node) => node.scrollTop)).toBe(0);
    const anchor = history.locator('[data-history-id="message-070"]');
    const anchorBefore = (await anchor.boundingBox())!.y;
    await history.getByRole('button', { name: /Load (earlier|older) messages/ }).click();
    await expect(history.locator('[data-history-id]')).toHaveCount(170);
    expect(Math.abs((await anchor.boundingBox())!.y - anchorBefore)).toBeLessThan(4);
    expect(await composer.boundingBox()).toEqual(fixedBefore);
    rows = [...rows, { ...rows[0], id: 'message-170', subject: 'Newest incoming reply', sent_at: '2026-11-07T04:00:00Z' }];
    await page.evaluate(() => window.dispatchEvent(new Event('crm:conversation-changed')));
    await expect(history.locator('[data-history-id="message-170"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
    expect(Math.abs((await anchor.boundingBox())!.y - anchorBefore)).toBeLessThan(4);
    await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
    await expect.poll(async () => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(4);
    await expect(composer.getByLabel('Message body', { exact: true })).toHaveValue('Keep this draft while reading history.');
    expect(await composer.boundingBox()).toEqual(fixedBefore);
    expect(data.unexpected).toEqual([]);
  });

  test(`${surface} toolbar fits two rows and opens tools above the fixed fields on short mobile screens`, async ({ page, data }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
      key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
      email: data.lead.email, address: data.lead.email, can_email: true, total: 0, unread: 0,
    }] } }));
    await page.goto(surface === 'account' ? `/clients/${data.account.id}?tab=communication`
      : surface === 'lead' ? `/leads?lead=${leadId}&tab=conversation` : `/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
    const composer = page.locator('[data-message-composer="email"]');
    await expect(composer).toBeVisible();
    const sender = composer.getByRole('combobox', { name: 'Send from', exact: true });
    await expect(sender.locator('option')).toHaveCount(2);
    await expect(sender.locator('option[value="gmail"]')).toBeEnabled();
    await expect(composer.getByRole('link', { name: /Connect Gmail|Reconnect Gmail/ })).toHaveCount(0);
    await expect(composer.getByRole('button', { name: /Refresh Gmail status/ })).toHaveCount(0);
    const toolbar = composer.getByRole('toolbar', { name: 'Conversation actions' });
    const buttons = await toolbar.locator('button').evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect(); return { y: box.y, width: box.width, height: box.height };
    }));
    expect(new Set(buttons.map((box) => box.y)).size).toBeLessThanOrEqual(2);
    expect(buttons.every((box) => box.width >= 32 && box.height >= 36 && box.height <= 36)).toBe(true);
    expect(await composer.locator('details').count()).toBe(0);
    await expect(composer.getByText('Write email', { exact: true })).toHaveCount(0);
    const subject = composer.getByLabel('Message subject', { exact: true });
    const body = composer.getByLabel('Message body', { exact: true });
    await body.fill('Draft survives popup changes.');
    const subjectBefore = await subject.boundingBox(), bodyBefore = await body.boundingBox();
    const trigger = toolbar.getByRole('button', { name: 'Appointments', exact: true });
    const triggerBounds = (await trigger.boundingBox())!;
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'Appointments', exact: true });
    await expect(popup).toBeVisible();
    const popupBounds = (await popup.boundingBox())!;
    expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(triggerBounds.y);
    expect(await subject.boundingBox()).toEqual(subjectBefore);
    expect(await body.boundingBox()).toEqual(bodyBefore);
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(body).toHaveValue('Draft survives popup changes.');
    const history = page.locator('[data-conversation-history]');
    const historyBefore = (await history.boundingBox())!.height;
    await composer.getByRole('button', { name: 'Minimize editor', exact: true }).click();
    await expect(body).not.toBeVisible();
    await expect.poll(async () => (await history.boundingBox())!.height - historyBefore).toBeGreaterThan(150);
    await composer.getByRole('button', { name: 'Expand editor', exact: true }).click();
    await expect(body).toHaveValue('Draft survives popup changes.');
    await toolbar.getByRole('button', { name: 'Sales templates', exact: true }).click();
    const templates = page.getByRole('dialog', { name: 'Sales templates', exact: true });
    await expect(templates).toBeVisible();
    expect((await templates.boundingBox())!.width).toBeLessThanOrEqual(296);
    await templates.getByRole('button', { name: 'Close Sales templates', exact: true }).click();
    const send = composer.getByRole('button', { name: /^(Send|Send Now|Send email)$/ });
    const sendRow = composer.locator('[data-composer-send-actions]');
    await expect(sendRow.getByRole('button', { name: 'Schedule send', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Schedule send', exact: true })).toHaveCount(0);
    const sendBounds = (await send.boundingBox())!, scheduleBounds = (await sendRow.getByRole('button', { name: 'Schedule send', exact: true }).boundingBox())!;
    expect(Math.abs(sendBounds.y - scheduleBounds.y)).toBeLessThanOrEqual(5);
    expect(scheduleBounds.x).toBeGreaterThan(sendBounds.x);
    await expect(send).toBeInViewport();
    const hit = await send.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { clickable: target === node || (target !== null && node.contains(target)), y: bounds.y,
        height: bounds.height, viewport: innerHeight, target: target?.tagName ?? null };
    });
    expect(hit.clickable, `Send must remain unobstructed: ${JSON.stringify(hit)}`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (surface !== 'account') await expect(toolbar.getByRole('button', { name: 'Attachments', exact: true })).toHaveCount(0);
    expect(data.unexpected).toEqual([]);
  });
}

test('expanded account conversations keep emails readable and provide a larger bounded writing area', async ({ page, data }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/api/communication-log?**', (route) => route.fulfill({ json: [{
    id: 'readable-email', channel: 'email', direction: 'inbound', subject: 'Coverage review',
    body: 'A requested coverage update. '.repeat(60), sent_at: '2026-11-07T04:00:00Z', read_at: '2026-11-07T04:00:00Z',
  }] }));
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  await drawer.getByRole('button', { name: 'Expand', exact: true }).click();
  const composer = drawer.locator('[data-message-composer="email"]');
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.width)).toBeGreaterThanOrEqual(1576);
  const message = drawer.locator('[data-conversation-message]').first();
  await expect(message).toBeVisible();
  expect((await message.boundingBox())!.width).toBeLessThanOrEqual(704);
  expect((await composer.boundingBox())!.width).toBeLessThanOrEqual(896);
  expect((await composer.getByLabel('Message body', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(180);
  await composer.getByLabel('Message body', { exact: true }).fill('Preserve expanded draft.');
  await composer.getByRole('button', { name: 'Minimize editor', exact: true }).click();
  await drawer.getByRole('button', { name: 'Collapse', exact: true }).click();
  await composer.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await expect(composer.getByLabel('Message body', { exact: true })).toHaveValue('Preserve expanded draft.');
});

test('lead profile keeps the same dark header and selected-tab contrast across sections', async ({ page }) => {
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  const header = drawer.locator('[data-lead-profile-header]');
  await expect(header.locator('input')).toHaveCount(0);
  await expect(header.getByRole('button', { name: /^Add / })).toHaveCount(0);
  for (const name of ['Overview', 'Assets', 'Quotes', 'Notes', 'Conversation', 'Tasks (1)']) {
    const tab = header.getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    expect(await header.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(15, 23, 42)');
    await expect.poll(() => tab.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)');
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 489, height: 426 }]) {
    await page.setViewportSize(viewport);
    await expect(header.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    expect((await header.boundingBox())!.height).toBeLessThan(160);
    await header.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit lead', exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const save = dialog.getByRole('button', { name: 'Save changes', exact: true });
    await save.scrollIntoViewIfNeeded();
    expect(await save.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight && node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
