import { test, expect } from './workspace-fixtures';

test('notification changes require acknowledgment and service templates affect only saved settings', async ({ page, data, settingsOwner }) => {
  void settingsOwner;
  await page.goto('/settings?tab=automation&section=rules');
  await expect(page.getByRole('button', { name: 'Edit In-app notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit In-app notifications', exact: true }).click();
  await page.getByLabel('Notify on claim, endorsement and certificate work', { exact: true }).uncheck();
  const save = page.getByRole('button', { name: 'Save automation', exact: true });
  await expect(page.getByRole('tabpanel', { name: 'Automation & Outreach' }).getByRole('alert')).toContainText('future agency-wide in-app alerts');
  await expect(save).toBeDisabled();
  await page.getByLabel('I understand these notification changes affect future alerts only.').check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Automation settings saved.');
  expect(data.automationConfiguration.notifications.service_events).toBe(false);

  await page.getByRole('button', { name: 'Edit Due reminders', exact: true }).click();
  await page.getByLabel('Notify when reminders become due', { exact: true }).uncheck();
  await expect(save).toBeDisabled();
  await page.getByLabel('I understand these notification changes affect future alerts only.').check();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Automation settings saved.');
  expect(data.automationConfiguration.reminders.enabled).toBe(false);

  await page.getByRole('button', { name: 'Edit Service requests', exact: true }).click();
  await page.getByLabel('claim subject', { exact: true }).fill('Review {service_type}: {account_name}');
  await page.getByLabel('claim instructions', { exact: true }).fill('Check the record before contacting the account.');
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Automation settings saved.');
  expect(data.automationConfiguration.service.task_templates.claim.description).toBe('Check the record before contacting the account.');
});
