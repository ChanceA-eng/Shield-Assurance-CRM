import { test, expect } from './workspace-fixtures';

test('account overview does not load full communication or hidden tabs until requested', async ({ page, data }) => {
  let releaseNotes: (() => void) | undefined;
  const notesPending = new Promise<void>((resolve) => { releaseNotes = resolve; });
  await page.route('**/api/interactions?**', async (route) => {
    await notesPending;
    await route.fulfill({ json: [] });
  });
  await page.goto(`/clients/${data.account.id}`);
  await expect(page.getByRole('heading', { name: data.account.full_name, exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading saved notes, tasks and documents' })).toBeVisible();
  releaseNotes?.();
  await expect(page.getByRole('status').filter({ hasText: 'Loading saved notes, tasks and documents' })).toHaveCount(0);
  expect(data.requests).not.toContain('GET /api/quote-options');
  expect(data.requests).not.toContain('GET /api/record-assets');
  expect(data.requests).not.toContain('GET /api/communication-log');
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/communication-log?**', async (route) => {
    await wait;
    await route.fulfill({ json: [] });
  });
  await page.getByRole('main').getByRole('button', { name: 'Communication', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading complete conversation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: data.account.full_name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Summarize Chat', exact: true })).toBeDisabled();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Risk review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Extract risk profile', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Loading conversation for risk insights' })).toBeVisible();
  release?.();
  await expect(page.getByRole('status').filter({ hasText: 'Loading complete conversation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Quotes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Manual quote options' })).toBeVisible();
  expect(data.requests).toContain('GET /api/quote-options');
});
