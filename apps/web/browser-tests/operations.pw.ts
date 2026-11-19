import { test, expect, leadId } from './workspace-fixtures';

test('task titles and lead queue actions open the exact sequence approval without sending', async ({ page, data }) => {
  const attempt = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
  const task = data.tasks[0];
  task.subject = 'Approve outreach: Leo Example';
  task.action_category = 'approval';
  task.action_href = `/outreach?attempt=${attempt}`;
  task.due_date = new Date(Date.now() - 60000).toISOString();
  data.outreachPending.push({
    id: attempt, lead_id: leadId, lead_name: 'Leo Example', step_number: 1, to_email: 'leo@example.invalid',
    subject: 'Your next step', body: 'Draft awaiting review', cited_signals: ['Commercial auto'],
    draft_revision: 0, created_at: new Date().toISOString(),
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: task.subject, exact: true }).click();
  await expect(page).toHaveURL(`/outreach?attempt=${attempt}`);
  await expect(page.locator(`[id="attempt-${attempt}"]`)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Approve and send', exact: true })).toBeVisible();

  await page.goto('/leads?view=queue');
  await page.getByRole('button').filter({ hasText: task.subject }).click();
  await expect(page).toHaveURL(`/outreach?attempt=${attempt}`);
  await expect(page.locator(`[id="attempt-${attempt}"]`)).toBeInViewport();
  expect(data.requests.filter((request) => request.includes('/outbox/'))).toEqual([]);
});

test('profile task titles open their saved action rather than leaving the agent on the profile', async ({ page, data }) => {
  const task = data.tasks[0];
  task.subject = 'Approve outreach: Leo Example';
  task.action_category = 'approval';
  task.action_href = '/outreach?attempt=168413e9-a6a4-4dff-a8bf-8f8df83dace8';
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: /^Tasks \(/ }).click();
  await drawer.getByRole('link', { name: task.subject, exact: true }).click();
  await expect(page).toHaveURL(task.action_href);
});

test('account next actions and task lists both open the saved destination', async ({ page, data }) => {
  const task = data.tasks[0];
  task.subject = 'Approve account outreach';
  task.related_type = 'client';
  task.related_id = data.account.id;
  task.action_category = 'approval';
  task.action_href = '/outreach?attempt=168413e9-a6a4-4dff-a8bf-8f8df83dace8';
  await page.goto(`/clients/${data.account.id}`);
  await page.getByRole('button').filter({ hasText: task.subject }).click();
  await expect(page).toHaveURL(task.action_href);
  await page.goto(`/clients/${data.account.id}?tab=tasks`);
  await page.getByRole('link', { name: task.subject, exact: true }).click();
  await expect(page).toHaveURL(task.action_href);
});

test('ordinary queue tasks still open the profile and Complete and Next follows the next action', async ({ page, data }) => {
  const first = data.tasks[0];
  first.due_date = new Date(Date.now() - 120000).toISOString();
  const action = {
    ...first, id: '168413e9-a6a4-4dff-a8bf-8f8df83dace9', subject: 'Approve next sequence email',
    due_date: new Date(Date.now() - 60000).toISOString(),
    action_href: '/outreach?attempt=168413e9-a6a4-4dff-a8bf-8f8df83dace8',
    action_category: 'approval' as const,
  };
  data.tasks.push(action);
  await page.goto('/leads?view=queue');
  await page.getByRole('button').filter({ hasText: first.subject }).click();
  await expect(page.getByRole('complementary', { name: 'Lead profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Close workspace', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: first.subject })
    .getByRole('button', { name: 'Complete & Next', exact: true }).click();
  await expect(page).toHaveURL(action.action_href);
  expect(data.tasks[0].status).toBe('completed');
  expect(data.tasks[1].status).toBe('open');
  expect(data.requests.filter((request) => request.includes('/outbox/'))).toEqual([]);
});

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
  await page.getByLabel('Snooze until (agency time)').fill('2099-12-10T10:30');
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

test('automation health distinguishes a partial run from the last successful run', async ({ page, settingsOwner }) => {
  void settingsOwner;
  await page.route('**/api/automation/health', (route) => route.fulfill({ json: { jobs: [{
    job: 'website-intake', last_success_at: '2026-11-01T16:00:00Z',
    latest: { id: 'qa-run', job: 'website-intake', status: 'partial',
      started_at: '2026-11-02T16:00:00Z', finished_at: '2026-11-02T16:01:00Z', error: 'One submission needs retry.' },
  }] } }));
  await page.goto('/settings?tab=automation&section=runs');
  await expect(page.getByText('Run results', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /website intake.*partial/ })).toBeVisible();
  await expect(page.getByText('One submission needs retry.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: 'Nov 1, 2026' })).toBeVisible();
});
