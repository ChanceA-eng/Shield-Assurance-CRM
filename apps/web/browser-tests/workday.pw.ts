import { test, expect, leadId } from './workspace-fixtures';

test('legacy Workday opens Tasks with one copy of each task, assignment and completed/reopen', async ({ page, data }) => {
  await page.goto('/workday');
  await expect(page).toHaveURL(/\/tasks$/);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: /Agency Workday/ })).toHaveCount(0);
  const task = data.tasks[0];
  await expect(page.getByText(task.subject, { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: `Reassign ${task.subject}`, exact: true }).click();
  const reassign = page.getByRole('dialog', { name: 'Reassign task' });
  await reassign.getByLabel('New assignee', { exact: true }).fill('Alex Producer');
  await reassign.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(reassign).toHaveCount(0);
  await expect(page.getByText('Alex Producer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Complete ${task.subject}`, exact: true }).click();
  await expect(page.getByText(task.subject, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Completed \(/ }).click();
  await page.getByRole('button', { name: `Reopen ${task.subject}`, exact: true }).click();
  await page.getByRole('button', { name: /^Open \(/ }).click();
  await expect(page.getByText(task.subject, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Additional follow-ups' })).toHaveCount(0);
});

test('New task popup uses named record selection, ignores Enter in record search and preserves ownership', async ({ page, data }) => {
  await page.goto('/tasks');
  await expect(page.getByLabel('Task action', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Task action', { exact: true }).fill('Collect the second truck VIN');
  await dialog.getByLabel('Task record type', { exact: true }).selectOption('lead');
  await dialog.getByLabel('Search related record', { exact: true }).press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Related record', { exact: true }).selectOption(leadId);
  await dialog.getByLabel('Task assignee', { exact: true }).fill('Alex Producer');
  await dialog.getByLabel('Task assignee', { exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leo Example: Collect the second truck VIN', exact: true })).toBeVisible();
  expect(data.tasks.filter((task) => task.subject.includes('second truck VIN'))).toHaveLength(1);
  expect(data.tasks.find((task) => task.subject.includes('second truck VIN'))).toMatchObject({ related_type: 'lead', related_id: leadId, assignee: 'Alex Producer' });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('dialog', { name: 'New task' }).getByLabel('Task action', { exact: true }).fill('Unsaved draft');
  page.once('dialog', (prompt) => void prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  page.once('dialog', (prompt) => void prompt.accept());
  await page.getByRole('button', { name: 'Close new task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New task' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
});

test('Tasks no longer loads a second work queue or duplicates converted website requests', async ({ page, data }) => {
  await page.goto('/tasks');
  await expect(page.getByText(data.tasks[0].subject, { exact: true })).toBeVisible();
  await expect(page.getByText('Respond to website request', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Additional follow-ups' })).toHaveCount(0);
  await expect(page.getByText('All clear', { exact: true })).toHaveCount(0);
  expect(data.requests).not.toContain('GET /api/workday');
});

test('automated service tasks open their actual request rather than another task screen', async ({ page, data }) => {
  data.tasks[0].action_href = '/clients/test-account?context_type=claim&context_id=test-claim';
  data.tasks[0].action_category = 'service';
  await page.route('**/clients/test-account?context_type=claim&context_id=test-claim', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Selected claim</h1></body></html>' }));
  await page.goto('/tasks');
  await expect(page.getByText('Service request', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Leo Example', exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/test-account\?context_type=claim&context_id=test-claim/);
  await expect(page.getByRole('heading', { name: 'Selected claim', exact: true })).toBeVisible();
});

test('Dashboard shows metrics and charts instead of a second task list or intake action desk', async ({ page, data }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operational metrics' })).toHaveCount(0);
  await expect(page.getByText('Total Written Premium', { exact: true })).toBeVisible();
  await expect(page.getByText('Written Premium - Last 12 Months', { exact: true })).toBeVisible();
  await expect(page.getByText('Upcoming Renewals (30 Days)', { exact: true })).toBeVisible();
  await expect(page.getByText('Review the current website request.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(data.tasks[0].subject, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Additional follow-ups' })).toHaveCount(0);
  expect(data.requests).not.toContain('GET /api/workday');
  expect(data.requests).not.toContain('GET /api/recent');
  expect(data.requests).not.toContain('GET /api/briefing');
  expect(data.requests).not.toContain('GET /api/policies');
  const [metricsResponse, renewalsResponse] = await Promise.all([
    page.request.get('/api/metrics/home'),
    page.request.get('/api/renewals?window=30'),
  ]);
  expect(metricsResponse.ok()).toBe(true);
  expect(renewalsResponse.ok()).toBe(true);
  const liveMetrics = await metricsResponse.json();
  const liveRenewals = await renewalsResponse.json();
  expect(liveMetrics.written_premium_series).toHaveLength(12);
  expect(liveMetrics.renewals_30_days).toBe(liveRenewals.counts['30']);
  expect(liveMetrics.total_written_premium).toBe(liveMetrics.totalPremium);
});
