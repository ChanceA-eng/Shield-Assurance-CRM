import { test, expect, leadId } from './workspace-fixtures';
import { navigationCategories } from '../src/config/navigation';

test('Back returns to the originating CRM view and survives a reload', async ({ page }) => {
  await page.goto('/leads?view=queue');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.reload();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/leads\?view=queue$/);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('direct account links have a safe return path on mobile', async ({ page, data }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/clients/${data.account.id}`);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
});

test('browser Back and reload cannot silently discard a new lead', async ({ page }) => {
  await page.goto('/clients');
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
  await sidebar.getByRole('button', { name: 'Leads', exact: true }).click();
  await sidebar.getByRole('link', { name: 'Lead Pipeline', exact: true }).click();
  await page.getByRole('button', { name: '+ New Lead', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New Lead', exact: true });
  await form.getByLabel('First name *', { exact: true }).fill('Retain this draft');
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.dismiss(); });
  await page.goBack();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(form.getByLabel('First name *', { exact: true })).toHaveValue('Retain this draft');
  const reloadDialog = page.waitForEvent('dialog');
  await page.evaluate(() => { window.setTimeout(() => window.location.reload(), 0); });
  const warning = await reloadDialog;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  await expect(form.getByLabel('First name *', { exact: true })).toHaveValue('Retain this draft');
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.accept(); });
  await page.goBack();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(form).toHaveCount(0);
});

test('sidebar warns before leaving edited account settings', async ({ page }) => {
  await page.route('**/api/account', (route) => route.fulfill({ json: {
    email: 'navigation-qa@example.invalid', full_name: 'Saved profile', contact_phone: '', role: 'owner',
  } }));
  await page.goto('/account');
  await page.getByLabel('Display name', { exact: true }).fill('Unfinished profile');
  const accounts = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Accounts', exact: true });
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.dismiss(); });
  await accounts.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Unfinished profile');
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.dismiss(); });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await accounts.click();
  await expect(page).toHaveURL(/\/clients$/);
});

test('closing intake asks before discarding, but an untouched form does not warn', async ({ page }) => {
  await page.goto('/leads');
  await page.getByRole('button', { name: '+ New Lead', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New Lead', exact: true });
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: '+ New Lead', exact: true }).click();
  await form.getByLabel('First name *', { exact: true }).fill('Unfinished');
  page.once('dialog', (dialog) => { void dialog.dismiss(); });
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(form).toBeVisible();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
});

test('course breadcrumbs omit nonexistent intermediate routes', async ({ page }) => {
  await page.route('**/api/learning/courses/list', (route) => route.fulfill({ json: { courses: [] } }));
  await page.route('**/api/learning/progress/get', (route) => route.fulfill({ json: { progress: [] } }));
  await page.goto('/learning/course/contractor-insurance-fundamentals/overview');
  const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await expect(breadcrumbs.getByRole('link', { name: 'Training', exact: true })).toHaveAttribute('href', '/learning');
  await expect(breadcrumbs.locator('a[href="/learning/course"]')).toHaveCount(0);
  await expect(breadcrumbs.locator('a[href="/learning/course/contractor-insurance-fundamentals"]')).toHaveCount(0);
});

test('policy shortcut stays in the app and returns to its exact lead view with a discard warning', async ({ page, data }) => {
  data.linked = true;
  data.lead.account_id = data.account.id;
  await page.route('**/api/policies/prefill?**', (route) => route.fulfill({ json: {
    account_id: data.account.id, account_name: data.account.full_name, lead_id: leadId,
    insured_name: data.lead.full_name, phone: data.lead.phone, email: data.lead.email,
    address: data.lead.address, line_of_business: data.lead.line_of_business,
  } }));
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [data.lead] }));
  await page.goto(`/leads?view=queue&lead=${leadId}`);
  await page.evaluate(() => { document.documentElement.dataset.navigationQa = 'same-document'; });
  await page.getByRole('button', { name: 'Record policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.navigationQa)).toBe('same-document');
  await page.getByPlaceholder('Carrier', { exact: true }).fill('Unfinished carrier');
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.dismiss(); });
  await page.evaluate(() => window.history.back());
  await expect(page.getByPlaceholder('Carrier', { exact: true })).toHaveValue('Unfinished carrier');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(new RegExp(`/leads\\?view=queue&lead=${leadId}$`));
  await expect(page.getByRole('complementary', { name: 'Lead profile' })).toBeVisible();
});

test('refreshing Gmail status preserves unsaved sender edits and their leave warning', async ({ page, data }) => {
  await page.route('**/api/agency', (route) => route.fulfill({ json: {
    member: { user_id: 'navigation-qa', email: 'navigation-qa@example.invalid', role: 'owner', active: true,
      sender_profile: data.outreachSettings.sender_profile, gmail_ai_opt_in: false },
    members: [], gmail_ai_enabled: false,
  } }));
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { connection: null, review: [] } }));
  await page.goto('/account?tab=signature');
  const sender = page.getByLabel('My display name', { exact: true }).or(page.getByRole('textbox', { name: 'Signature', exact: true }));
  await sender.fill('Unfinished sender');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(sender).toHaveValue('Unfinished sender');
  page.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/unsaved changes/i); void dialog.dismiss(); });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page).toHaveURL(/\/account\?tab=signature$/);
  await expect(sender).toHaveValue('Unfinished sender');
});

test('account editing keeps its draft when closing or navigating is cancelled', async ({ page }) => {
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Edit account', exact: true });
  await editor.getByRole('textbox', { name: 'Account name', exact: true }).fill('Unfinished account edit');
  page.once('dialog', (warning) => { expect(warning.message()).toMatch(/unsaved changes/i); void warning.dismiss(); });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Account name', exact: true })).toHaveValue('Unfinished account edit');
  page.once('dialog', (warning) => { void warning.accept(); });
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('Dashboard closes the mobile navigation and leaves content usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).not.toBeVisible();
});

test('all sidebar destinations resolve without authentication redirects or broken pages', async ({ context }) => {
  const destinations = ['/', ...navigationCategories.flatMap((category) => category.sections
    ? category.sections.flatMap((section) => section.items.map((item) => item.href)) : category.href ? [category.href] : [])];
  for (const href of destinations) {
    const response = await context.request.get(href);
    expect(response.status(), href).toBe(200);
    expect(new URL(response.url()).pathname, href).not.toBe('/login');
  }
});
