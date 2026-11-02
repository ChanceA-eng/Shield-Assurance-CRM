import { test, expect, leadId } from './workspace-fixtures';

test('navigation distinguishes Pipeline and Work Queue without closing the desktop sidebar', async ({ page }) => {
  await page.goto('/leads');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Work Queue', exact: true }).click();
  await expect(page).toHaveURL(/view=queue/, { timeout: 15000 });
  await expect(nav.getByRole('link', { name: 'Work Queue', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Lead Pipeline', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Work Queue', { exact: false }).last()).toBeVisible();
  await nav.getByRole('link', { name: 'Lead Pipeline', exact: true }).click();
  await expect(page).not.toHaveURL(/view=queue/);
  await expect(nav.getByRole('link', { name: 'Lead Pipeline', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Marketplace', exact: true })).toHaveCount(0);
});

test('snooze failure retains custom time and succeeds after a deliberate retry', async ({ page, data }) => {
  await page.goto('/tasks');
  const task = data.tasks[0];
  await page.getByRole('combobox', { name: `Snooze ${task.subject}`, exact: true }).selectOption('custom');
  const value = `${new Date().getUTCFullYear() + 1}-12-01T14:15`;
  const picker = page.getByLabel('Snooze until (Arizona time)', { exact: true });
  await picker.fill(value);
  data.failTaskSave = true;
  await page.getByRole('button', { name: 'Save snooze', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This task changed' }).first()).toBeVisible();
  await expect(picker).toHaveValue(value);
  await page.getByRole('button', { name: 'Save snooze', exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(data.tasks[0].due_date).toBe(`${value.slice(0, 10)}T21:15:00.000Z`);
});

test('calendar deep links open past events and list completion can be reopened', async ({ page, data }) => {
  const event = { id: 'ac753cd3-cd0d-423b-a30e-66d2709d0d5e', subject: 'Annual coverage review', title: 'Annual coverage review', event_date: '2025-01-07', event_time: '14:15', all_day: false, status: 'scheduled', related_type: 'lead', related_id: leadId, updated_at: data.stamp() };
  data.events.push(event);
  await page.goto(`/scheduler?event=${event.id}`);
  const dialog = page.getByRole('dialog', { name: 'Edit Event', exact: true });
  await expect(dialog.getByLabel('Event title', { exact: true })).toHaveValue('Annual coverage review');
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2025-01-07');
  await expect(dialog.getByLabel('Time (Arizona)', { exact: true })).toHaveValue('14:15');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  expect(data.events[0].status).toBe('scheduled');
  expect(data.requests.some((request) => request.includes('scheduled-messages'))).toBe(false);
});

test('calendar save failure keeps a named account appointment draft', async ({ page, data }) => {
  await page.goto('/scheduler');
  await page.getByRole('button', { name: '+ New Event', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Event', exact: true });
  await dialog.getByLabel('Event title', { exact: true }).fill('Review trucks');
  await dialog.getByLabel('Time (Arizona)', { exact: true }).fill('14:15');
  await dialog.getByLabel('Link to', { exact: true }).selectOption('lead');
  await dialog.getByLabel('Related record', { exact: true }).selectOption(leadId);
  data.failEventSave = true;
  await dialog.getByRole('button', { name: 'Save Event', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This event changed. Refresh before retrying.');
  await expect(dialog.getByLabel('Event title', { exact: true })).toHaveValue('Review trucks');
  await dialog.getByRole('button', { name: 'Save Event', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(data.events[0]).toMatchObject({ title: 'Review trucks', event_time: '14:15', related_type: 'lead', related_id: leadId });
});
