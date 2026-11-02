import { test, expect, leadId } from './workspace-fixtures';

test('banners retain every unworked arrival in newest-first order and acknowledge only the opened request', async ({ page, data }) => {
  data.addArrivals(26);
  await page.goto('/');
  const queue = page.getByRole('region', { name: 'Unreviewed website requests' });
  await expect(queue.getByRole('link', { name: 'Open profile', exact: true })).toHaveCount(26);
  await expect(queue.locator('p a')).toHaveText(data.arrivals.map((arrival) => arrival.full_name));
  await expect(page.getByRole('link', { name: '12 due today', exact: true })).toHaveCount(0);
  await queue.getByRole('button', { name: 'Dismiss request from Leo Example', exact: true }).click();
  await expect(queue.getByRole('link', { name: 'Open profile', exact: true })).toHaveCount(25);
  await page.reload();
  await expect(queue.getByRole('link', { name: 'Open profile', exact: true })).toHaveCount(25);
  data.addArrivals(26);
  await page.goto(`/leads?lead=${leadId}`);
  await expect(page.getByRole('button', { name: 'Add note', exact: true }).first()).toBeVisible();
  await expect(queue.getByRole('link', { name: 'Open profile', exact: true })).toHaveCount(25);
  expect(data.arrivals.every((arrival) => arrival.id !== leadId)).toBe(true);
});

test('notes and dated named reminders survive a failed response, complete and reopen across profile and global Tasks', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Client reported three trucks. Request all VINs before quoting.');
  await page.getByLabel('Also create a reminder', { exact: true }).check();
  await page.getByLabel('Action to take', { exact: true }).fill('Request all VINs');
  await page.getByLabel('Date and time - Arizona (UTC-7)', { exact: true }).fill('2026-11-02T09:30');
  data.failNoteAfterCommit = true;
  await page.getByRole('button', { name: 'Save note & reminder', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary response failure' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Client reported three trucks. Request all VINs before quoting.');
  await page.getByRole('button', { name: 'Save note & reminder', exact: true }).click();
  await expect(page.getByText('Note and reminder saved together.', { exact: true })).toBeVisible();
  expect(data.notes).toHaveLength(1);
  expect(data.noteSaveIds[0]).toBe(data.noteSaveIds[1]);
  const reminder = data.tasks.find((task) => task.note_id === data.notes[0].id);
  expect(reminder?.subject).toBe('Leo Example: Request all VINs');
  expect(reminder?.due_date).toBe('2026-11-02T16:30:00.000Z');
  await page.getByRole('button', { name: /^Tasks \(/ }).click();
  await page.getByRole('button', { name: 'Complete Leo Example: Request all VINs', exact: true }).click();
  await page.getByRole('button', { name: /^Completed \(/ }).click();
  await expect(page.getByRole('button', { name: 'Reopen Leo Example: Request all VINs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen Leo Example: Request all VINs', exact: true }).click();
  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'Open Leo Example', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Complete Leo Example: Request all VINs', exact: true }).click();
  await page.getByRole('button', { name: /^Completed \(/ }).click();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open Leo Example', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen Leo Example: Request all VINs', exact: true }).click();
  expect(data.tasks.find((task) => task.id === reminder?.id)?.status).toBe('open');
  expect(data.requests.some((request) => request.includes('/api/ai/') || request.endsWith('/draft-outreach'))).toBe(false);
});

test('multiple assets retain per-type drafts and archive/restore without changing coverage', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Add asset', exact: true }).first().click();
  await page.getByLabel('Name / label', { exact: true }).fill('Truck 1');
  await page.getByLabel('Make', { exact: true }).fill('Ford');
  await page.getByLabel('Year', { exact: true }).fill('2022');
  await page.getByRole('combobox', { name: 'Asset type', exact: true }).selectOption('property');
  await page.getByLabel('Property address', { exact: true }).fill('123 Test Street');
  await page.getByRole('combobox', { name: 'Asset type', exact: true }).selectOption('vehicle');
  await expect(page.getByLabel('Make', { exact: true })).toHaveValue('Ford');
  await page.getByRole('combobox', { name: 'Asset type', exact: true }).selectOption('property');
  await expect(page.getByLabel('Property address', { exact: true })).toHaveValue('123 Test Street');
  await page.getByRole('combobox', { name: 'Asset type', exact: true }).selectOption('vehicle');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Truck 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add asset', exact: true }).first().click();
  await page.getByLabel('Name / label', { exact: true }).fill('Truck 2');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Truck 2', exact: true })).toBeVisible();
  expect(data.assets).toHaveLength(2);
  await page.getByRole('button', { name: 'Archive', exact: true }).first().click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Truck 1', exact: true })).toBeVisible();
  expect(data.assets.every((asset) => !asset.archived_at)).toBe(true);
  await expect(page.getByText(/Inventory is not an insured schedule/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Leo Example/ }).click();
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Truck 2', exact: true })).toBeVisible();
});

test('explicit account linking preserves saved-work IDs and client refreshes do not discard another tab draft', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Call notes to carry forward to the account.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('Note saved to this account history.', { exact: true })).toBeVisible();
  const noteId = data.notes[0].id;
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Link / create account', exact: true }).click();
  await page.getByRole('button', { name: 'Create separate prospect account', exact: true }).click();
  await page.getByRole('link', { name: 'Open account: Leo Example', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${data.account.id}`), { timeout: 15000 });
  await expect(page.getByText('Lifecycle: Prospect', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await expect(page.getByText('Call notes to carry forward to the account.', { exact: true })).toBeVisible();
  expect(data.notes[0].id).toBe(noteId);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A separate call, not an edit of the old note.');
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('A separate call, not an edit of the old note.', { exact: true })).toBeVisible();
  expect(data.notes).toHaveLength(2);
  expect(data.notes.find((note) => note.id === noteId)?.content).toBe('Call notes to carry forward to the account.');
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Unsaved call draft must survive another tab save.');
  await page.getByRole('button', { name: 'Add asset', exact: true }).first().click();
  await page.getByLabel('Name / label', { exact: true }).fill('Account property');
  await page.getByRole('combobox', { name: 'Asset type', exact: true }).selectOption('property');
  await page.getByLabel('Property address', { exact: true }).fill('456 Test Street');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account property', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Notes/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Unsaved call draft must survive another tab save.');
  data.policies = [{ id: 'policy', client_id: data.account.id, status: 'active', effective_date: '2020-01-01', expiration_date: '2099-01-01', carrier: 'Test carrier' }];
  await page.reload();
  await expect(page.getByText('Lifecycle: Active client', { exact: true })).toBeVisible();
});

test('dedicated account directory supports search, filters, pagination and a focused mobile profile', async ({ page, data }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '30 matching accounts' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).fill('Leo');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Active clients', exact: true }).click();
  await expect(page.getByText('No clients found.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Prospects', exact: true }).click();
  await page.getByRole('link', { name: 'Leo Example', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next actions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pinned notes', exact: true })).toBeVisible();
  await expect(page.getByText('Underwriting Risk Analysis', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Communication', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Client Conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Assets & People', exact: true }).click();
  await expect(page.getByText(/Inventory is not an insured schedule/)).toBeVisible();
  expect(data.requests.some((request) => request.includes('/api/ai/'))).toBe(false);
});

test('new lead intake warns about existing records, prefills drivers, and opens the created lead', async ({ page, data }) => {
  await page.goto('/leads');
  await page.getByRole('button', { name: '+ New Lead', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Lead' });
  await dialog.getByLabel('First name *', { exact: true }).fill('Maria');
  await dialog.getByLabel('Last name *', { exact: true }).fill('Lopez');
  await dialog.getByLabel('Phone *', { exact: true }).fill('(602) 555-0142');
  await dialog.getByLabel('Email', { exact: true }).fill(data.lead.email);
  await expect(dialog.getByText('Possible existing record', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('href', `/leads?lead=${leadId}`);
  await dialog.getByLabel('Email', { exact: true }).fill('maria@example.invalid');
  await dialog.getByRole('combobox', { name: 'Lead source *', exact: true }).selectOption('referral');
  await dialog.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(dialog.getByLabel('Driver 1 name *', { exact: true })).toHaveValue('Maria Lopez');
  await dialog.getByLabel('Make', { exact: true }).fill('Toyota');
  await dialog.getByRole('button', { name: 'Create personal lead', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add note', exact: true }).first()).toBeVisible();
  const intake = data.intakeBodies[0]?.intake as Record<string, unknown> | undefined;
  expect(intake).toMatchObject({ kind: 'personal', source: 'referral', coverages: ['auto'] });
  expect(intake?.drivers).toEqual([expect.objectContaining({ name: 'Maria Lopez', relationship: 'Self' })]);
  expect(intake?.vehicles).toEqual([expect.objectContaining({ make: 'Toyota' })]);
});

test('unread client messages raise a red badge and tasks snooze to a picked Arizona date and time', async ({ page, data }) => {
  data.unreadMessages = { total: 2, byClient: { [data.account.id]: 2 }, byLead: { [leadId]: 2 } };
  await page.goto('/tasks');
  await expect(page.getByLabel('2 unread messages', { exact: true }).first()).toBeVisible();
  const seeded = data.tasks[0];
  await page.getByRole('combobox', { name: `Snooze ${seeded.subject}`, exact: true }).selectOption('custom');
  const picker = page.getByLabel('Snooze until (Arizona time)', { exact: true });
  await expect(picker).toBeVisible();
  const year = new Date().getUTCFullYear() + 1;
  await picker.fill(`${year}-12-01T14:15`);
  await page.getByRole('button', { name: 'Save snooze', exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(data.tasks.find((task) => task.id === seeded.id)?.due_date).toBe(`${year}-12-01T21:15:00.000Z`);
  await page.getByRole('combobox', { name: `Snooze ${seeded.subject}`, exact: true }).selectOption('nextweek');
  await expect.poll(() => new Date(data.tasks.find((task) => task.id === seeded.id)?.due_date ?? 0).getUTCHours()).toBe(16);
});

test('policy profile shows confirmed term dates and links only to its same-account prior term', async ({ page, data }) => {
  const currentId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
  const priorId = 'c3db2f75-a682-4d14-8c76-693b4f123456';
  const prior = { id: priorId, policy_number: 'POLICY-OLD', effective_date: '2024-01-01', expiration_date: '2025-01-01', status: 'expired' };
  const current = { id: currentId, client_id: data.account.id, insured_name: data.account.full_name, carrier: 'Verified Carrier',
    line_of_business: 'Commercial', sub_type: 'Auto', premium: 2450.75, policy_number: 'POLICY-CURRENT',
    effective_date: '2025-01-01', renewal_date: '2026-01-01', expiration_date: '2026-01-01',
    status: 'expired', billing_type: 'direct', source: 'confirmed issuance', prior_policy_id: priorId,
    quote_snapshot: { carrier: 'Quoted Carrier', premium: 2300, line_of_business: 'Commercial Auto', notes: 'Historical quote only' },
    related_prior_term: prior };
  data.policies.push(current);
  await page.route('**/api/clients/*/context?*', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: { type: 'policy', record: url.searchParams.get('id') === priorId ? prior : current } });
  });
  await page.goto(`/clients/${data.account.id}?context_type=policy&context_id=${currentId}`);
  const term = page.getByRole('region', { name: 'Policy term details' });
  await expect(term.getByText('POLICY-CURRENT')).toBeVisible();
  await expect(term.getByText('$2,450.75')).toBeVisible();
  await expect(term.getByText('2025-01-01', { exact: true })).toBeVisible();
  await expect(term.getByText('2026-01-01', { exact: true })).toHaveCount(2);
  await term.getByRole('link', { name: /POLICY-OLD/ }).click();
  await expect(page.getByRole('region', { name: 'Policy term details' }).getByText('POLICY-OLD')).toBeVisible();
});