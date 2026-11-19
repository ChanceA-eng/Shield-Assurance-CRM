import { test, expect, leadId } from './workspace-fixtures';

test('account-derived composer preserves lead tools, account attachments and Gmail reply state across all surfaces', async ({ page, data }) => {
  let sends = 0;
  const keyErrors: string[] = [];
  page.on('console', (message) => { if (message.text().includes('same key')) keyErrors.push(message.text()); });
  await page.route('**/api/communication-log', (route) => {
    if (route.request().method() === 'POST') sends++;
    return route.fulfill({ json: [] });
  });
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  const leadComposer = page.locator('[data-message-composer="email"]');
  const fieldClass = await leadComposer.getByLabel('Message subject', { exact: true }).getAttribute('class');
  const bodyClass = await leadComposer.getByLabel('Message body', { exact: true }).getAttribute('class');
  const sendClass = await leadComposer.getByRole('button', { name: 'Send', exact: true }).getAttribute('class');
  await leadComposer.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Draft with AI', exact: true });
  await expect(draft.getByLabel('Email purpose')).toBeVisible();
  await expect(draft.getByRole('checkbox', { name: 'Include current confirmed dossier findings in this AI draft only' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(leadComposer.getByRole('button', { name: 'Follow-up sequences', exact: true })).toBeVisible();

  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const account = page.getByRole('complementary', { name: 'Client conversation' });
  const accountComposer = account.locator('[data-message-composer="email"]');
  await expect(accountComposer.getByLabel('Message subject', { exact: true })).toHaveAttribute('class', fieldClass!);
  await expect(accountComposer.getByLabel('Message body', { exact: true })).toHaveAttribute('class', bodyClass!);
  await expect(accountComposer.getByRole('button', { name: 'Send Now', exact: true })).toHaveAttribute('class', sendClass!);
  await accountComposer.getByLabel('Message body', { exact: true }).fill('Keep this account draft with its attachment.');
  await accountComposer.getByRole('button', { name: 'Attachments', exact: true }).click();
  const attachments = page.getByRole('dialog', { name: 'Attachments', exact: true });
  await attachments.locator('input[type="file"]').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic browser fixture') });
  await page.keyboard.press('Escape');
  await accountComposer.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await expect(schedule.getByRole('button', { name: 'Confirm schedule', exact: true })).toBeDisabled();
  await expect(schedule.getByText('Scheduled attachments are not supported.', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await account.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(accountComposer.getByLabel('Message body', { exact: true })).toHaveValue('Keep this account draft with its attachment.');

  await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
    key: `client:${data.account.id}`, kind: 'client', client_id: data.account.id, lead_id: null, name: 'Synthetic account',
    email: 'synthetic@example.test', address: 'synthetic@example.test', can_email: true, total: 1, unread: 0,
  }] } }));
  await page.route('**/api/gmail/threads?**', (route) => route.fulfill({ json: { enabled: true,
    rows: [{ id: 'synthetic-reply', subject: 'Policy review', sent_at: new Date().toISOString() }],
  } }));
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { default_provider: 'resend',
    connection: { email: 'agent@example.test', status: 'connected', sync_enabled: false } } }));
  await page.goto('/communication');
  await page.locator('[data-conversation-key]').filter({ hasText: 'Synthetic account' }).click();
  const inbox = page.locator('[data-message-composer="email"]');
  await expect(inbox.getByLabel('Message subject', { exact: true })).toHaveAttribute('class', fieldClass!);
  await expect(inbox.getByLabel('Message body', { exact: true })).toHaveAttribute('class', bodyClass!);
  await expect(inbox.getByRole('button', { name: 'Send email', exact: true })).toHaveAttribute('class', sendClass!);
  await inbox.getByLabel('Message body', { exact: true }).fill('Keep my draft when selecting a reply.');
  await inbox.getByRole('button', { name: 'Reply to an email', exact: true }).click();
  const reply = page.getByRole('dialog', { name: 'Reply to an email', exact: true });
  await reply.getByLabel('Email to reply to').selectOption('synthetic-reply');
  await expect(inbox.getByLabel('Message subject', { exact: true })).toHaveValue('Re: Policy review');
  await expect(inbox.getByLabel('Message body', { exact: true })).toHaveValue('Keep my draft when selecting a reply.');
  await expect(reply.getByRole('button', { name: 'Draft reply with AI', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-message-composer="email"]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Gmail threads' })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: 'Schedule send', exact: true })).toHaveCount(1);
  await inbox.getByRole('button', { name: 'Schedule send', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'Confirm schedule', exact: true })).toBeDisabled();
  await expect(schedule.getByText('Clear the reply selection to schedule a new email.')).toBeVisible();
  expect(sends).toBe(0);
  expect(keyErrors).toEqual([]);
});
