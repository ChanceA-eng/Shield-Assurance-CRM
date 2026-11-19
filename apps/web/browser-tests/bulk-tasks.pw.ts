import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type WorkspaceData } from './workspace-fixtures';

function seed(data: WorkspaceData): void {
  const original = data.tasks[0];
  if (!original) throw new Error('Expected the default task fixture.');
  data.tasks = [
    { ...original, subject: 'Bulk first', due_date: '2026-11-06T00:30:00Z' },
    { ...original, id: randomUUID(), subject: 'Bulk second', due_date: '2026-11-06T00:30:45Z' },
    { ...original, id: randomUUID(), subject: 'Other time', due_date: '2026-11-05T19:00:00Z' },
    { ...original, id: randomUUID(), subject: 'Other day', due_date: '2026-11-07T00:30:00Z' },
    { ...original, id: randomUUID(), subject: 'Completed task', due_date: '2026-11-06T00:30:00Z', status: 'completed' },
  ];
}

async function openDueFilter(page: Page): Promise<Locator> {
  const panel = page.getByRole('dialog', { name: 'Due filter' });
  await expect(async () => {
    if (!(await panel.isVisible())) await page.getByRole('button', { name: /^Due filter/ }).click();
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  return panel;
}

test('toolbar has no bulk form until tasks are selected; filter, reschedule via popup and reload', async ({ page, data }) => {
  seed(data);
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Select Bulk first', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected tasks' })).toHaveCount(0);
  await expect(page.getByLabel(/^New due date\/time/)).toHaveCount(0);
  const filter = await openDueFilter(page);
  await filter.getByLabel('Filter current due date').fill('2026-11-05');
  await filter.getByLabel('Filter current due time').fill('17:30');
  await filter.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(filter).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Due filter (2)', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Select Bulk / })).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Select Other time', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Completed task', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select Bulk first', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Bulk second', exact: true }).check();
  const bar = page.getByRole('region', { name: 'Selected tasks' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reschedule 2 tasks' });
  await dialog.getByLabel('New due date/time - America/Phoenix').fill('2026-11-08T09:15');
  await dialog.getByRole('button', { name: 'Reschedule 2 tasks', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '2 tasks rescheduled' })).toBeVisible();
  await expect(bar).toHaveCount(0);
  expect(data.bulkTaskBodies).toHaveLength(1);
  expect(data.bulkTaskBodies[0]).toMatchObject({ due_date: '2026-11-08T16:15:00.000Z' });
  expect(data.tasks.slice(0, 2).every((task) => task.due_date === '2026-11-08T16:15:00.000Z' && task.status === 'open')).toBe(true);
  expect(data.tasks[2]?.due_date).toBe('2026-11-05T19:00:00Z');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloaded = await openDueFilter(page);
  await reloaded.getByLabel('Filter current due date').fill('2026-11-08');
  await reloaded.getByLabel('Filter current due time').fill('09:15');
  await expect(page.getByRole('checkbox', { name: /^Select Bulk / })).toHaveCount(2);
});

test('select all is filtered, concurrent edits reject the entire batch in the popup, and reselecting recovers', async ({ page, data }) => {
  seed(data);
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Select Bulk first', exact: true })).toBeVisible();
  await (await openDueFilter(page)).getByLabel('Filter current due time').fill('17:30');
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select all filtered open tasks' }).check();
  const bar = page.getByRole('region', { name: 'Selected tasks' });
  await expect(bar).toContainText('3 selected');
  const staleTask = data.tasks[1];
  if (!staleTask) throw new Error('Expected the second task fixture.');
  staleTask.updated_at = data.stamp();
  await bar.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reschedule 3 tasks' });
  await expect(dialog.getByRole('button', { name: 'Reschedule 3 tasks', exact: true })).toBeDisabled();
  await dialog.getByLabel('New due date/time - America/Phoenix').fill('2026-11-10T10:00');
  await dialog.getByRole('button', { name: 'Reschedule 3 tasks', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'No tasks were rescheduled' })).toBeVisible();
  expect(data.tasks[0]?.due_date).toBe('2026-11-06T00:30:00Z');
  expect(data.tasks[1]?.due_date).toBe('2026-11-06T00:30:45Z');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Select Bulk first', exact: true })).toBeVisible();
  await (await openDueFilter(page)).getByLabel('Filter current due time').fill('17:30');
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select all filtered open tasks' }).check();
  await page.getByRole('region', { name: 'Selected tasks' }).getByRole('button', { name: 'Reschedule', exact: true }).click();
  const retry = page.getByRole('dialog', { name: 'Reschedule 3 tasks' });
  await retry.getByLabel('New due date/time - America/Phoenix').fill('2026-11-10T10:00');
  await retry.getByLabel('New due date/time - America/Phoenix').press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '3 tasks rescheduled' })).toBeVisible();
});

test('mobile toolbar and selection bar fit, clearing filters resets selection and completed view hides selection', async ({ page, data }) => {
  seed(data);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Select Bulk first', exact: true })).toBeVisible();
  const filter = await openDueFilter(page);
  await filter.getByLabel('Filter current due date').fill('2026-11-05');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select all filtered open tasks' }).check();
  const bar = page.getByRole('region', { name: 'Selected tasks' });
  await expect(bar).toContainText('3 selected');
  const box = await bar.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await (await openDueFilter(page)).getByRole('button', { name: 'Clear due filters' }).click();
  await expect(bar).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select Bulk first', exact: true }).check();
  await expect(bar).toContainText('1 selected');
  await page.getByRole('button', { name: 'Completed (1)', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^Select / })).toHaveCount(0);
});

test('reassign popup saves the owner and keeps the popup open with the error when saving fails', async ({ page, data }) => {
  seed(data);
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Reassign Bulk first', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reassign task' });
  await expect(dialog.getByLabel('New assignee', { exact: true })).toBeFocused();
  data.failTaskSave = true;
  await dialog.getByLabel('New assignee', { exact: true }).fill('Servicing agent');
  await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('New assignee', { exact: true })).toHaveValue('Servicing agent');
  await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Servicing agent', { exact: true })).toBeVisible();
  expect(data.tasks[0]?.assignee).toBe('Servicing agent');
});
test('real authenticated bulk API persists both tasks and rejects stale batches atomically', async ({ context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for persistence verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const accountId = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  const originalDue = '2026-11-05T17:30:00.000Z';
  const newDue = '2026-11-08T16:15:00.000Z';
  try {
    const account = await admin.from('clients').insert({ id: accountId, full_name: 'Disposable bulk task verification' });
    if (account.error) throw new Error(account.error.message);
    const inserted = await admin.from('tasks').insert(ids.map((id) => ({
      id, subject: 'Disposable bulk task verification', related_type: 'client', related_id: accountId, account_id: accountId,
      due_date: originalDue, status: 'open', priority: 'high', assignee: 'QA assignee',
    }))).select('id,updated_at');
    if (inserted.error) throw new Error(inserted.error.message);
    const selected = inserted.data.map(({ id, updated_at }) => ({ id, expected_updated_at: updated_at }));
    const saved = await context.request.patch('/api/tasks/bulk-reschedule', { data: { tasks: selected, due_date: newDue } });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).updated).toBe(2);
    const reloaded = await context.request.get(`/api/tasks?record_type=client&record_id=${accountId}`);
    expect(reloaded.status()).toBe(200);
    const rows: Array<{ id: string; updated_at: string; due_date: string; status: string; priority: string; assignee: string }> = await reloaded.json();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Date.parse(row.due_date)).toBe(Date.parse(newDue));
      expect(row).toMatchObject({ status: 'open', priority: 'high', assignee: 'QA assignee' });
    }
    const concurrent = await admin.from('tasks').update({ description: 'QA-only concurrent edit' }).eq('id', ids[1]);
    if (concurrent.error) throw new Error(concurrent.error.message);
    const conflict = await context.request.patch('/api/tasks/bulk-reschedule', { data: {
      tasks: rows.map(({ id, updated_at }) => ({ id, expected_updated_at: updated_at })), due_date: originalDue,
    } });
    expect(conflict.status(), await conflict.text()).toBe(409);
    const persisted = await admin.from('tasks').select('id,due_date').in('id', ids);
    if (persisted.error) throw new Error(persisted.error.message);
    expect(persisted.data).toHaveLength(2);
    expect(persisted.data.every((row) => Date.parse(row.due_date) === Date.parse(newDue))).toBe(true);
  } finally {
    const notifications = await admin.from('notifications').delete().in('task_id', ids);
    const tasks = await admin.from('tasks').delete().in('id', ids);
    const activities = await admin.from('client_activities').delete().eq('client_id', accountId);
    const account = await admin.from('clients').delete().eq('id', accountId);
    const failures = [notifications.error, tasks.error, activities.error, account.error].filter(Boolean);
    if (failures.length) throw new Error(`Bulk task QA cleanup failed: ${failures.map((error) => error?.message).join('; ')}`);
  }
});
