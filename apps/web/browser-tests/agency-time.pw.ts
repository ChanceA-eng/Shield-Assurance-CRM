import { expect, test } from './workspace-fixtures';

test('agency outreach send window saves and reloads the configured time zone', async ({ page, data, settingsOwner }) => {
  void settingsOwner;
  await page.goto('/settings?tab=automation&section=sequences');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Agency time zone', { exact: true })).toHaveValue('America/Phoenix');

  await page.getByLabel('Agency time zone', { exact: true }).selectOption('America/New_York');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  expect(data.outreachSettings.timezone).toBe('America/New_York');

  await page.reload();
  await expect(page.getByLabel('Agency time zone', { exact: true })).toHaveValue('America/New_York');
});

test('calendar uses agency-local labels and event times', async ({ page, data }) => {
  data.outreachSettings = { ...data.outreachSettings, timezone: 'America/New_York' };
  await page.goto('/scheduler');
  await expect(page.getByRole('heading', { name: 'Calendar & Events', exact: true })).toBeVisible();
  await expect(page.getByText('All times are America/New_York.')).toBeVisible();
  await page.getByRole('button', { name: '+ New Event', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Event', exact: true });
  await dialog.getByLabel('Event title').fill('Agency timezone appointment');
  await dialog.getByLabel('Time (America/New_York)').fill('09:15');
  await dialog.getByRole('button', { name: 'Save Event', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(data.events).toHaveLength(1);
  expect(data.events[0]).toMatchObject({ title: 'Agency timezone appointment', event_time: '09:15' });
});
