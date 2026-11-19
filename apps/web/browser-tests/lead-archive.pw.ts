import { test, expect } from './workspace-fixtures';

test('archive, restore and permanently delete a lead from the Archived view', async ({ page, data }) => {
  const lead = { ...data.lead, archived_at: null as string | null };
  let deleted = false;
  const actions: Array<{ action: string; ids: string[] }> = [];

  await page.route((url) => url.pathname === '/api/leads', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.fallback();
    const archivedView = url.searchParams.get('status') === 'archived';
    const visible = !deleted && (archivedView ? lead.archived_at !== null : lead.archived_at === null);
    await route.fulfill({ json: visible ? [lead] : [] });
  });
  await page.route('**/api/leads/archive', async (route) => {
    const body = route.request().postDataJSON() as { action: string; ids: string[] };
    actions.push(body);
    if (body.action === 'archive') lead.archived_at = '2026-11-03T12:00:00.000Z';
    if (body.action === 'restore') lead.archived_at = null;
    if (body.action === 'delete') deleted = true;
    const outcome = body.action === 'archive' ? 'archived' : body.action === 'restore' ? 'restored' : 'deleted';
    const message = body.action === 'archive' ? '1 lead archived.' : body.action === 'restore' ? '1 lead restored.' : '1 lead permanently deleted.';
    await route.fulfill({ json: { results: [{ id: lead.id, outcome, name: lead.full_name }], message } });
  });

  await page.goto('/leads');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: lead.full_name });
  await expect(row).toBeVisible();

  page.once('dialog', (dialog) => { expect(dialog.type()).toBe('confirm'); void dialog.accept(); });
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('1 lead archived.')).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByRole('button', { name: 'Archived leads', exact: true }).click();
  await expect(row).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete all archived permanently' })).toBeVisible();

  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('1 lead restored.')).toBeVisible();
  await expect(row).toHaveCount(0);

  lead.archived_at = '2026-11-03T12:05:00.000Z';
  await page.getByRole('button', { name: 'Back to active pipeline' }).click();
  await page.getByRole('button', { name: 'Archived leads', exact: true }).click();
  await expect(row).toBeVisible();

  page.once('dialog', (dialog) => { expect(dialog.type()).toBe('prompt'); void dialog.accept('nope'); });
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Nothing was deleted. Type DELETE to confirm a permanent delete.')).toBeVisible();
  expect(actions.filter((item) => item.action === 'delete')).toHaveLength(0);

  page.once('dialog', (dialog) => void dialog.accept('DELETE'));
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('1 lead permanently deleted.')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(actions).toEqual([
    { action: 'archive', ids: [lead.id] },
    { action: 'restore', ids: [lead.id] },
    { action: 'delete', ids: [lead.id] },
  ]);
});
