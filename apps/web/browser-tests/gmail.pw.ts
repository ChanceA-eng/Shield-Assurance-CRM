import { test, expect, leadId } from './workspace-fixtures';

const replyId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
test('Gmail reply shows own sender, safe imported content and retries with the same send ID', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/gmail/threads?**', (route) => route.fulfill({ json: {
    enabled: true, next_offset: null, sender: { name: 'Taylor', email: 'taylor@example.invalid', status: 'connected' },
    rows: [{ id: replyId, subject: 'Your request', body: '<script>unsafeMarkup()</script>\nPlease call me.', direction: 'inbound', sent_at: '2026-10-31T12:00:00Z',
      metadata: { gmail_thread_id: 'thread1', from: 'leo@example.invalid', attachments: [{ name: 'policy.pdf', imported: false }] } }],
  } }));
  await page.route('**/api/communication-log', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: requests.length === 1 ? 503 : 200, json: requests.length === 1
      ? { message: 'Gmail acceptance is uncertain. Do not resend.' } : { ok: true, delivery_status: 'accepted_by_provider' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Gmail threads' });
  await expect(panel).toContainText('taylor@example.invalid');
  await panel.getByLabel('Message to reply to').selectOption(replyId);
  await expect(panel.locator('[data-conversation-message]')).toContainText('<script>unsafeMarkup()</script>');
  await expect(panel.locator('[data-conversation-message]')).toContainText('Please call me.');
  await expect(panel.locator('script')).toHaveCount(0);
  await expect(panel).toContainText('policy.pdf (not imported; view in Gmail)');
  await panel.getByLabel('Reply for your review').fill('I can help with that request.');
  await panel.getByRole('button', { name: 'Approve and send reply' }).click();
  await expect(panel.getByRole('alert')).toContainText('acceptance is uncertain');
  await panel.getByRole('button', { name: 'Approve and send reply' }).click();
  await expect(panel.getByRole('status')).toContainText('recipient delivery is not confirmed');
  expect(requests).toHaveLength(2);
  expect(requests[0]?.request_id).toBe(requests[1]?.request_id);
  expect(requests[0]).toMatchObject({ lead_id: leadId, reply_to_message_id: replyId, subject: 'Re: Your request' });
});

test('Gmail AI privacy denial remains explicit and never sends or substitutes a reply', async ({ page }) => {
  let sends = 0;
  await page.route('**/api/gmail/threads?**', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { message: 'AI use of this Gmail thread is not authorized by all source agents.' } })
    : route.fulfill({ json: { enabled: true, next_offset: null, sender: { name: 'Taylor', email: 'taylor@example.invalid', status: 'connected' },
      rows: [{ id: replyId, subject: 'Question', body: 'Actual customer question.', direction: 'inbound', sent_at: '2026-10-31T12:00:00Z', metadata: { gmail_thread_id: 't1', from: 'leo@example.invalid' } }] } }));
  await page.route('**/api/communication-log', (route) => { if (route.request().method() === 'POST') sends += 1; return route.fallback(); });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Gmail threads' });
  await panel.getByLabel('Message to reply to').selectOption(replyId);
  await panel.getByRole('button', { name: 'Draft reply with AI' }).click();
  await expect(panel.getByRole('alert')).toContainText('not authorized');
  await expect(panel.getByLabel('Reply for your review')).toHaveValue('');
  expect(sends).toBe(0);
});
