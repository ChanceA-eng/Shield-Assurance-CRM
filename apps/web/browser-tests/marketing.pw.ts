import { test, expect, leadId } from './workspace-fixtures';

test('marketing profile and selected purpose persist without invoking AI or sending', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  await page.getByLabel('Stated insurance interests', { exact: true }).fill('Commercial auto');
  await page.getByLabel('Priorities / what matters most', { exact: true }).fill('Keep the process simple');
  await page.getByLabel('Agreed next step', { exact: true }).fill('Request VIN by email');
  await page.getByLabel('Source (for example: customer call on Nov 2)', { exact: true }).fill('Customer call');
  await page.getByLabel('Last confirmed', { exact: true }).fill('2026-10-30');
  await page.getByLabel('Preferred next-step channel', { exact: true }).selectOption('email');
  await page.getByLabel('Default email purpose', { exact: true }).selectOption('missing_information');
  await page.getByRole('button', { name: 'Save marketing profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Marketing profile saved.' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  await expect(page.getByLabel('Stated insurance interests', { exact: true })).toHaveValue('Commercial auto');
  await expect(page.getByLabel('Default email purpose', { exact: true })).toHaveValue('missing_information');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save marketing profile', exact: true })).toBeVisible();
  expect(data.marketingProfiles.size).toBe(1);
  expect(data.requests.some((request) => request.includes('/api/ai/') || request.endsWith('/draft-outreach') || request.includes('/outreach/run'))).toBe(false);
});

test('shared sender settings persist and remain accessible at mobile width', async ({ page, data }) => {
  await page.goto('/outreach');
  await expect(page.getByRole('heading', { name: 'Agency sender profile', exact: true })).toBeVisible();
  await page.getByLabel('Producer name', { exact: true }).fill('Taylor');
  await page.getByLabel('Signature', { exact: true }).fill('Taylor\nShield Assurance');
  await page.getByLabel('Writing style', { exact: true }).fill('Warm, clear and concise.');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Producer name', { exact: true })).toHaveValue('Taylor');
  await expect(page.getByLabel('Signature', { exact: true })).toHaveValue('Taylor\nShield Assurance');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
  expect(data.outreachSettings.sender_profile.name).toBe('Taylor');
  expect(data.requests.some((request) => request.includes('/api/ai/') || request.includes('/outreach/run'))).toBe(false);
});
