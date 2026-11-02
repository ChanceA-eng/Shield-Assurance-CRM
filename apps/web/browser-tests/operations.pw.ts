import { test, expect } from './workspace-fixtures';

test('automated message actions use ordinary Tasks assignment and snooze without a separate work screen', async ({ page, data }) => {
  const task = data.tasks[0];
  task.action_category = 'reply';
  task.action_href = '/communication?conversation=unmatched%3Aperson%40example.invalid';
  await page.goto('/tasks');
  await expect(page.getByText('Message', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Reassign ${task.subject}`, exact: true }).click();
  await page.getByLabel('New assignee', { exact: true }).fill('Servicing agent');
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(page.getByText('Servicing agent', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Servicing agent', { exact: true })).toBeVisible();
  await page.getByLabel(`Snooze ${task.subject}`, { exact: true }).selectOption('custom');
  await page.getByLabel('Snooze until (Arizona time)').fill('2099-12-10T10:30');
  await page.getByRole('button', { name: 'Save snooze', exact: true }).click();
  await expect.poll(() => task.due_date).toBe('2099-12-10T17:30:00.000Z');
  await page.reload();
  await expect(page.getByText(task.subject, { exact: true })).toHaveCount(1);
  expect(data.requests).not.toContain('GET /api/workday');
  await expect(page.getByText('Intake & automation health', { exact: true })).toHaveCount(0);
});

test('Inbox pages all conversations and explicitly loads older messages', async ({ page }) => {
  await page.route('**/api/communication/inbox**', (route) => {
    const url = new URL(route.request().url()), second = url.searchParams.get('page') === '1';
    const address = second ? 'older@example.invalid' : 'recent@example.invalid';
    return route.fulfill({ json: { total: 26, page: second ? 1 : 0, page_size: 25, conversations: [{
      key: `unmatched:${address}`, kind: 'unmatched', client_id: null, lead_id: null, name: second ? 'Older conversation' : 'Recent conversation',
      email: address, phone: null, address, href: '/communication', can_email: true, last_subject: 'Question', last_snippet: 'Please help',
      last_direction: 'inbound', last_channel: 'email', last_at: '2026-11-02T16:00:00Z', unread: 1, total: 201,
    }] } });
  });
  await page.route('**/api/communication-log?**', (route) => {
    const older = new URL(route.request().url()).searchParams.get('offset') === '200';
    return route.fulfill({ headers: { 'X-Next-Offset': older ? '' : '200' }, json: [{
      id: older ? 'older-message' : 'recent-message', channel: 'email', direction: 'inbound', subject: 'Question',
      body: older ? 'The older history is here' : 'The recent question', sent_at: older ? '2026-10-01T16:00:00Z' : '2026-11-02T16:00:00Z', read_at: '2026-11-02T16:00:00Z', metadata: {},
    }] });
  });
  await page.goto('/communication');
  await page.getByRole('button', { name: 'Next conversations', exact: true }).click();
  await page.getByRole('button', { name: /Older conversation/ }).click();
  await expect(page.getByText('The recent question', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
  await expect(page.getByText('The older history is here', { exact: true })).toBeVisible();
  await expect(page.getByText('The recent question', { exact: true })).toBeVisible();
});

test('automation health distinguishes a partial run from the last successful run', async ({ page }) => {
  await page.route('**/api/automation/health', (route) => route.fulfill({ json: { jobs: [{
    job: 'website-intake', last_success_at: '2026-11-01T16:00:00Z',
    latest: { id: 'qa-run', job: 'website-intake', status: 'partial',
      started_at: '2026-11-02T16:00:00Z', finished_at: '2026-11-02T16:01:00Z', error: 'One submission needs retry.' },
  }] } }));
  await page.goto('/settings');
  await page.getByText('Intake & automation health', { exact: true }).click();
  await expect(page.getByText('website intake: partial', { exact: true })).toBeVisible();
  await expect(page.getByText('One submission needs retry.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last success:.*2026.*AZ/)).toBeVisible();
});
