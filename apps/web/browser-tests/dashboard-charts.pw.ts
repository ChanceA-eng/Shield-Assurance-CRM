import { test, expect } from './workspace-fixtures';

test('premium and animated task charts are compact side-by-side, truthful and responsive', async ({ page, data }) => {
  await page.route('**/api/metrics/home', (route) => route.fulfill({ json: {
    total_written_premium: 1000, active_leads: 1, lead_conversion_rate: 0.5, renewals_30_days: 0, open_claims: 0,
    written_premium_series: Array.from({ length: 12 }, (_, i) => ({ month: `Month ${i + 1}`, premium: 100 + i })),
  } }));
  await page.route('**/api/metrics/tasks', (route) => route.fulfill({ json: { on_time: 8, overdue: 3, open: 5, completed: 10, unclassified: 1 } }));
  await page.goto('/');
  const charts = page.locator('[data-dashboard-charts]');
  await expect(charts.getByRole('img', { name: 'Task timing: 8 completed on time, 3 overdue or completed late, 5 open and not overdue, 1 timing unknown', exact: true })).toBeVisible();
  await expect(charts.getByText('Completed: 10', { exact: true })).toBeVisible();
  await expect(charts.getByText('Completed on time: 8', { exact: true })).toBeVisible();
  await expect(charts.getByText('Open / not overdue: 5', { exact: true })).toBeVisible();
  await expect(charts.getByText('Overdue / completed late: 3', { exact: true })).toBeVisible();
  await expect(charts.getByText('1 task lacks reliable timing.', { exact: true })).toBeVisible();
  await expect(charts.locator('.recharts-area')).toHaveCount(1);
  await expect.poll(() => charts.locator('.recharts-pie-sector path[fill="#4dbd74"]').count()).toBe(1);
  await expect(charts.locator('.recharts-pie-sector path[fill="#f86c6b"]')).toHaveCount(1);
  const panels = charts.locator(':scope > div');
  const premium = (await panels.nth(0).boundingBox())!, tasks = (await panels.nth(1).boundingBox())!;
  expect(tasks.x).toBeGreaterThan(premium.x + premium.width - 1);
  expect(Math.abs(premium.y - tasks.y)).toBeLessThan(2);
  expect((await charts.locator('.recharts-responsive-container').first().boundingBox())!.height).toBe(208);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await panels.nth(1).boundingBox())!.y).toBeGreaterThan((await panels.nth(0).boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(data.unexpected).toEqual([]);
});

test('task chart distinguishes an empty dataset from failure and supports retry', async ({ page }) => {
  await page.route('**/api/metrics/home', (route) => route.fulfill({ json: {
    total_written_premium: 0, written_premium_series: [], active_leads: 0, lead_conversion_rate: 0, renewals_30_days: 0, open_claims: 0,
  } }));
  let failure = true;
  await page.route('**/api/metrics/tasks', (route) => route.fulfill(failure
    ? { status: 503, json: { message: 'Task metrics temporarily unavailable.' } }
    : { json: { on_time: 0, overdue: 0, open: 0, completed: 0, unclassified: 0 } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Task metrics temporarily unavailable.' })).toBeVisible();
  await expect(page.getByText('No tasks yet.', { exact: true })).toHaveCount(0);
  failure = false;
  await page.getByRole('button', { name: 'Retry task chart', exact: true }).click();
  await expect(page.getByText('No tasks yet.', { exact: true })).toBeVisible();
});
