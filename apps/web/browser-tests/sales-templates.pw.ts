import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, leadId } from './workspace-fixtures';
import { DEFAULT_EMAIL_DESIGN, SALES_TEMPLATES } from '@crm/shared';

test('conversation inserts reviewed details without sending placeholders', async ({ page }) => {
  let fail = true;
  await page.route('**/api/sales-templates**', (route) => fail
    ? route.fulfill({ status: 503, json: { message: 'Details unavailable.' } })
    : route.fulfill({ json: { templates: [], facts: { contact_name: 'Jane Example' }, recommended: [] } }));
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  const body = drawer.getByPlaceholder(/Email .*or type an instruction/);
  await body.fill('Hello there');
  await body.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(6, 11); });
  await drawer.getByRole('button', { name: 'Insert a detail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert a detail' });
  await expect(dialog.getByRole('alert')).toContainText('Details unavailable');
  await expect(dialog.getByRole('button', { name: 'Insert detail' })).toBeDisabled();
  fail = false;
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByLabel('Value')).toHaveValue('Jane Example');
  await dialog.getByRole('button', { name: 'Insert detail' }).click();
  await expect(body).toHaveValue('Hello Jane Example');
  await drawer.getByRole('button', { name: 'Insert a detail' }).click();
  await dialog.getByRole('combobox').selectOption('business_name');
  await expect(dialog.getByLabel('Value')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Insert detail' })).toBeDisabled();
  await dialog.getByLabel('Value').fill('{{business_name}}');
  await expect(dialog.getByRole('button', { name: 'Insert detail' })).toBeDisabled();
  await dialog.getByLabel('Value').fill('Example Plumbing');
  await dialog.getByRole('button', { name: 'Insert detail' }).click();
  await expect(body).toHaveValue('Hello Jane ExampleExample Plumbing');
});

test('conversation lets an owner design images and branding, save, then apply without sending', async ({ page }) => {
  const original = SALES_TEMPLATES.find((item) => item.id === 'introduction')!;
  let template = { ...original };
  let failSave = true, sends = 0;
  await page.route('**/api/sales-templates**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: {
      templates: [template], canManage: true,
      facts: { contact_name: 'Client', agent_name: 'Agent', agency_name: 'Test Agency' }, recommended: [],
    } });
    if (route.request().method() === 'PATCH') {
      if (failSave) return route.fulfill({ status: 503, json: { message: 'Design save unavailable. Your changes are not saved.' } });
      template = { ...route.request().postDataJSON(), revision: template.revision + 1 };
      return route.fulfill({ json: template });
    }
    return route.fulfill({ json: { subject: 'Welcome', body: 'Hello Client',
      template: { id: template.id, revision: template.revision, email_design: template.email_design } } });
  });
  await page.route('**/api/communication-log', (route) => {
    if (route.request().method() === 'POST') sends++;
    return route.fulfill({ json: [] });
  });
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  await picker.getByLabel('Choose sales template').selectOption(original.id);
  await picker.getByRole('textbox', { name: 'insurance interest', exact: true }).fill('commercial auto');
  const styles = picker.getByRole('group', { name: 'Email layout styles' });
  await expect(styles.getByRole('button')).toHaveCount(4);
  await styles.getByRole('button', { name: 'Announcement / invitation', exact: true }).click();
  await expect(picker.getByRole('textbox', { name: 'Brand name', exact: true })).toHaveValue('Test Agency');
  await picker.getByRole('textbox', { name: 'Heading', exact: true }).fill('Your coverage review');
  await picker.getByRole('textbox', { name: 'Logo image link', exact: true }).fill('https://example.invalid/logo.png');
  await picker.getByRole('textbox', { name: 'Banner image link', exact: true }).fill('https://example.invalid/banner.png');
  await picker.getByRole('textbox', { name: 'Banner description', exact: true }).fill('Agency team');
  const preview = picker.frameLocator('iframe[title="Email design preview"]');
  await expect(preview.getByRole('heading', { name: 'Your coverage review' })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Agency team' })).toHaveAttribute('src', 'https://example.invalid/banner.png');
  await picker.getByRole('checkbox').check();
  await expect(picker.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Save template design', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('not saved');
  await expect(picker.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue('Your coverage review');
  failSave = false;
  await picker.getByRole('button', { name: 'Save template design', exact: true }).click();
  await expect(picker.getByRole('status')).toContainText('Design saved');
  await expect(picker.getByRole('checkbox')).not.toBeChecked();
  await picker.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: 'Branded email preview', exact: true }).click();
  const applied = page.getByRole('dialog', { name: 'Branded email preview' }).frameLocator('iframe[title="Email design preview"]');
  await expect(applied.getByRole('heading', { name: 'Your coverage review' })).toBeVisible();
  await expect(applied.getByRole('img', { name: 'Test Agency', exact: true })).toHaveAttribute('src', 'https://example.invalid/logo.png');
  expect(sends).toBe(0);
});

test('branded template editor previews and saves the selected design', async ({ page, settingsOwner: _owner }) => {
  let savedDesign: unknown;
  await page.route('**/api/sales-templates**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as { email_design: unknown };
    savedDesign = body.email_design;
    return route.fulfill({ json: { ...body, revision: 1 } });
  });
  await page.goto('/settings?tab=automation&section=templates');
  await page.getByLabel('Saved CRM templates', { exact: true }).selectOption('introduction');
  await page.getByRole('combobox', { name: 'Email layout', exact: true }).selectOption('announcement');
  await page.getByLabel('Brand name', { exact: true }).fill('Shield Example');
  await page.getByLabel('Heading', { exact: true }).fill('Welcome aboard');
  await page.getByLabel('Banner image link', { exact: true }).fill('https://example.invalid/banner.png');
  await page.getByLabel('Banner description', { exact: true }).fill('Agency team');
  await page.getByLabel('Button label', { exact: true }).fill('View details');
  await page.getByLabel('Button link', { exact: true }).fill('https://example.invalid/details');
  const preview = page.frameLocator('iframe[title="Email design preview"]');
  await expect(preview.getByRole('heading', { name: 'Welcome aboard' })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'View details' })).toHaveAttribute('href', 'https://example.invalid/details');
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mobile', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved in CRM');
  expect(savedDesign).toMatchObject({ layout: 'announcement', heading: 'Welcome aboard', image_alt: 'Agency team', button_url: 'https://example.invalid/details' });
});

test('conversation previews the branded template after editing without sending', async ({ page }) => {
  const design = { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Shield Example', heading: 'Welcome',
    button_label: 'View details', button_url: 'https://example.invalid/details' };
  const template = { ...SALES_TEMPLATES.find((item) => item.id === 'introduction')!, email_design: design };
  let sends = 0;
  await page.route('**/api/sales-templates**', (route) => route.fulfill({ json: route.request().method() === 'POST'
    ? { subject: 'Hello', body: 'Hello client', template: { id: template.id, revision: template.revision, email_design: design } }
    : { templates: [template], facts: { contact_name: 'Client', agent_name: 'Agent', agency_name: 'Agency' }, recommended: [] } }));
  await page.route('**/api/communication-log', (route) => { if (route.request().method() === 'POST') sends++; return route.fulfill({ json: [] }); });
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Conversation', exact: true }).click();
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  await picker.getByLabel('Choose sales template').selectOption('introduction');
  await picker.getByRole('textbox', { name: 'insurance interest', exact: true }).fill('commercial auto');
  await picker.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(drawer.getByPlaceholder(/Email .*or type an instruction/)).toHaveValue('Hello client');
  await page.keyboard.press('Escape');
  await drawer.getByPlaceholder(/Email .*or type an instruction/).fill('My edited message');
  await drawer.getByRole('button', { name: 'Branded email preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Branded email preview' }).frameLocator('iframe[title="Email design preview"]');
  await expect(preview.getByText('My edited message')).toBeVisible();
  await expect(preview.getByRole('link', { name: 'View details' })).toHaveAttribute('href', design.button_url);
  expect(sends).toBe(0);
});

test('lead library previews, verifies facts, retains drafts and applies without sending', async ({ page }) => {
  let sends = 0;
  await page.route('**/api/appointments?**', (route) => route.fulfill({ json: { appointments: [
    { id: '168413e9-a6a4-4dff-a8bf-8f8df83dace6', details: 'January 10 at 9 AM, phone appointment · America/Phoenix' },
  ] } }));
  await page.route('**/api/communication-log', async (route) => {
    if (route.request().method() === 'POST') sends++;
    await route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 489, height: 426 });
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Conversation', exact: true }).click();
  const composer = drawer.getByPlaceholder(/Email .*or type an instruction/);
  await composer.fill('Keep this existing draft.');
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  await picker.getByLabel('Choose sales template').selectOption('appointment_confirmation');
  await picker.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(picker.getByLabel('Choose sales template')).toHaveValue('');
  await picker.getByLabel('Choose sales template').selectOption('appointment_confirmation');
  await expect(picker.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled();
  await picker.getByRole('combobox', { name: 'Scheduled appointment', exact: true }).selectOption('168413e9-a6a4-4dff-a8bf-8f8df83dace6');
  await picker.getByRole('checkbox').check();
  await expect(picker.getByRole('button', { name: 'Use template', exact: true })).toBeEnabled();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(composer).toHaveValue('Keep this existing draft.');
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(composer).toHaveValue(/January 10 at 9 AM/);
  await expect(drawer.getByPlaceholder('Subject', { exact: true })).toHaveValue('Our appointment');
  await page.keyboard.press('Escape');
  await composer.fill('My edited template draft.');
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await picker.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(composer).toHaveValue('My edited template draft.');
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect(drawer.getByPlaceholder('Subject', { exact: true })).toHaveValue('');
  await expect(picker.getByRole('button', { name: 'Remove template', exact: true })).toHaveCount(0);
  expect(sends).toBe(0);
});

test('account SMS templates remain drafts and cannot send or schedule', async ({ page, data }) => {
  const keyErrors: string[] = [];
  page.on('console', (message) => { if (message.text().includes('same key')) keyErrors.push(message.text()); });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  await drawer.getByLabel('Conversation toolbar').getByRole('combobox').selectOption('sms');
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  await picker.getByLabel('Choose sales template').selectOption('introduction');
  await picker.getByRole('textbox', { name: 'insurance interest', exact: true }).fill('commercial auto');
  await picker.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(drawer.getByLabel('Message body')).toHaveValue(/Verification agent/);
  await expect(drawer.getByRole('button', { name: 'Send Now', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await expect(schedule.getByText('Text sending and scheduling are unavailable', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(drawer.getByLabel('Message body')).toHaveValue('');
  expect(keyErrors).toEqual([]);
});

test('later sales touches are browsable, grounded and applied without sending', async ({ page }) => {
  let sends = 0;
  await page.route('**/api/communication-log', (route) => {
    if (route.request().method() === 'POST') sends++;
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Conversation', exact: true }).click();
  await drawer.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  const choices = picker.getByLabel('Choose sales template');
  await expect(choices.locator('option')).toHaveCount(SALES_TEMPLATES.length + 1);
  for (const id of ['contact_second_followup', 'contact_third_followup', 'contact_fourth_followup',
    'contact_fifth_followup', 'contact_sixth_followup', 'meeting_third_followup', 'meeting_fourth_followup',
    'meeting_fifth_followup', 'meeting_sixth_followup', 'quote_third_followup', 'quote_fourth_followup',
    'quote_fifth_followup', 'quote_sixth_followup']) {
    await expect(choices.locator(`option[value="${id}"]`)).toHaveCount(1);
  }
  await choices.selectOption('contact_third_followup');
  await picker.getByRole('checkbox').check();
  await expect(picker.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled();
  await picker.getByRole('textbox', { name: 'insurance interest', exact: true }).fill('commercial auto');
  await picker.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(drawer.getByPlaceholder(/Email .*or type an instruction/)).toHaveValue(/deductible and exclusions can matter as much as the price/);
  await expect(drawer.getByPlaceholder('Subject', { exact: true })).toHaveValue('Compare more than the premium');
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(sends).toBe(0);
});

test('optional sales sequences show steps and require explicit reviewed enrollment', async ({ page }) => {
  let enrolled = false;
  await page.route('**/api/sales-sequences**', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ preset: 'initial_contact', confirmed: true, gap: 5 });
      enrolled = true;
      return route.fulfill({ status: 201, json: { message: 'Enrolled. First draft requires approval in Outreach. Automatic sending is off.' } });
    }
    return route.fulfill({ json: { actor: 'qa', appointments: [], quotes: [], rows: [] } });
  });
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Conversation', exact: true }).click();
  await drawer.getByRole('button', { name: 'Follow-up sequences', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Follow-up sequences', exact: true });
  await expect(panel.getByRole('button', { name: 'Create review-first sequence', exact: true })).toBeDisabled();
  await expect(panel.getByText(/Step 1: Agent introduction/)).toBeVisible();
  await panel.getByRole('checkbox', { name: 'I reviewed these steps, timing and facts.' }).check();
  await panel.getByRole('button', { name: 'Create review-first sequence', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Automatic sending is off');
  expect(enrolled).toBe(true);
});

test('inbox and Gmail share template selection and failed rendering retains the existing draft', async ({ page, data }) => {
  let sends = 0, failRender = true;
  await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
    key: `client:${data.account.id}`, kind: 'client', client_id: data.account.id, lead_id: null, name: 'Synthetic account',
    email: 'synthetic@example.test', address: 'synthetic@example.test', can_email: true, href: '', total: 1, unread: 0,
  }] } }));
  await page.route('**/api/gmail/threads?**', (route) => route.fulfill({ json: {
    enabled: true, sender: { status: 'connected', name: 'QA agent', email: 'agent@example.test' },
    rows: [{ id: 'template-thread', direction: 'inbound', subject: 'Policy review', body: 'Synthetic incoming email',
      sent_at: new Date().toISOString(), metadata: { from: 'synthetic@example.test', gmail_thread_id: 'template-thread' } }],
  } }));
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { default_provider: 'resend',
    connection: { email: 'agent@example.test', status: 'connected', sync_enabled: false } } }));
  await page.route('**/api/communication-log', (route) => { if (route.request().method() === 'POST') sends++; return route.fulfill({ json: [] }); });
  await page.route('**/api/sales-templates**', (route) => {
    if (route.request().method() === 'POST' && failRender) return route.fulfill({ status: 503, json: { message: 'Template service unavailable. Your draft is unchanged.' } });
    return route.fallback();
  });
  await page.goto('/communication');
  await page.locator('[data-conversation-key]').filter({ hasText: 'Synthetic account' }).click();
  const inbox = page.getByPlaceholder('Email Synthetic account…', { exact: true });
  await inbox.fill('Keep this inbox draft.');
  await page.getByRole('button', { name: 'Sales templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Sales templates', exact: true });
  await picker.getByLabel('Choose sales template').selectOption('introduction');
  await picker.getByRole('textbox', { name: 'insurance interest', exact: true }).fill('commercial auto');
  await picker.getByRole('checkbox').check();
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('unavailable');
  await expect(inbox).toHaveValue('Keep this inbox draft.');
  failRender = false;
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(inbox).toHaveValue(/Verification agent/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reply to an email', exact: true }).click();
  await page.getByRole('dialog', { name: 'Reply to an email', exact: true }).getByLabel('Email to reply to').selectOption('template-thread');
  await expect(inbox).toHaveValue(/Verification agent/);
  await expect(page.getByRole('textbox', { name: 'Message subject', exact: true })).toHaveValue('Re: Policy review');
  await expect(page.locator('[data-message-composer="email"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sales templates', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await picker.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(inbox).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Message subject', exact: true })).toHaveValue('');
  expect(sends).toBe(0);
});

test('Settings retains unsaved edits after failure and requires an explicit save retry', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let attempts = 0;
  await page.route('**/api/sales-templates**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { message: 'Save unavailable. Your changes are not saved.' } });
    return route.fulfill({ json: { ...route.request().postDataJSON(), revision: 1 } });
  });
  await page.goto('/settings?tab=automation&section=templates');
  await page.getByLabel('Saved CRM templates', { exact: true }).selectOption('introduction');
  await expect(page.getByLabel('Saved CRM templates', { exact: true }).locator('option[value="introduction"]')).toHaveText('Agent introduction - touch 1');
  await expect(page.getByLabel('Saved CRM templates', { exact: true })).not.toContainText('built-in default');
  const body = page.getByRole('textbox', { name: 'Email body', exact: true });
  await body.fill('Retain my explicitly edited message for {{contact_name}}.');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not saved' })).toBeVisible();
  await expect(body).toHaveValue('Retain my explicitly edited message for {{contact_name}}.');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved in CRM - version 1.');
  expect(attempts).toBe(2);
});

test('Settings saves persist, admins can manage and a second agent can use but not overwrite them', async ({ page, context, authCookies, settingsOwner }) => {
  test.setTimeout(60000);
  void settingsOwner;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createServerClient(url, anon, { cookies: { getAll: () => authCookies, setAll: () => {} } });
  const identity = await auth.auth.getUser();
  const owner = identity.data.user;
  if (!owner || owner.user_metadata.crm_browser_qa !== true) throw new Error('Disposable browser identity required');
  const name = `Synthetic saved sales template ${randomUUID()}`;
  let templateId = '', secondId = '';
  try {
    await page.route('**/api/sales-templates**', async (route) => route.continue());
    await page.goto('/settings?tab=automation&section=templates');
    await page.getByRole('button', { name: 'New template', exact: true }).click();
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Email subject', exact: true }).fill('Synthetic saved subject');
    await page.getByRole('textbox', { name: 'Email body', exact: true }).fill('Hello {{contact_name}}, this is a saved synthetic CRM template.');
    await page.getByRole('textbox', { name: 'Short SMS version', exact: true }).fill('Hi {{contact_name}}, synthetic SMS draft only.');
    await page.getByRole('combobox', { name: 'Email layout', exact: true }).selectOption('welcome');
    await page.getByRole('textbox', { name: 'Brand name', exact: true }).fill('Synthetic Agency');
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Welcome to Synthetic Agency');
    const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/sales-templates') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    const saved = await (await savedResponse).json();
    templateId = saved.id;
    await expect(page.getByRole('status')).toHaveText('Saved in CRM - version 1.');
    await page.reload();
    await page.getByLabel('Saved CRM templates', { exact: true }).selectOption(templateId);
    await expect(page.getByRole('textbox', { name: 'Email body', exact: true })).toHaveValue('Hello {{contact_name}}, this is a saved synthetic CRM template.');
    await expect(page.getByRole('combobox', { name: 'Email layout', exact: true })).toHaveValue('welcome');
    await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue('Welcome to Synthetic Agency');
    const adminRole = await db.from('agency_members').update({ role: 'admin' }).eq('user_id', owner.id);
    if (adminRole.error) throw new Error('Cannot set disposable admin role');
    await page.reload();
    await page.getByLabel('Saved CRM templates', { exact: true }).selectOption(templateId);
    await page.getByRole('textbox', { name: 'Email subject', exact: true }).fill('Admin saved revision');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved in CRM - version 2.');
    const password = `${randomUUID()}${randomUUID()}`, email = `crm-template-agent-${randomUUID()}@example.invalid`;
    const created = await test.step('Create second disposable agent', () => db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { crm_browser_qa: true } }));
    if (created.error || !created.data.user) throw new Error('Cannot create disposable second agent');
    secondId = created.data.user.id;
    const member = await db.from('agency_members').insert({ user_id: secondId, email, role: 'agent', active: true });
    if (member.error) throw new Error('Cannot grant disposable agent membership');
    const secondAuth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await test.step('Authenticate second agent', () => secondAuth.auth.signInWithPassword({ email, password }));
    if (signedIn.error || !signedIn.data.session) throw new Error('Cannot sign in disposable agent');
    const headers = { authorization: `Bearer ${signedIn.data.session.access_token}` };
    const library = await test.step('Read saved library as second agent', () => context.request.get('/api/sales-templates', { headers }));
    expect(library.status()).toBe(200);
    expect((await library.json()).templates).toContainEqual(expect.objectContaining({ id: templateId, subject: 'Admin saved revision', revision: 2 }));
    const denied = await test.step('Reject agent library write', () => context.request.patch('/api/sales-templates', { headers, data: { ...saved, revision: 2 } }));
    expect(denied.status()).toBe(403);
    const rendered = await context.request.post('/api/sales-templates', { headers, data: {
      id: templateId, revision: 2, channel: 'email', conversation: 'unmatched:synthetic@example.test', facts: { contact_name: 'Synthetic agent preview' }, confirmed: true,
    } });
    expect(rendered.status()).toBe(200);
    expect(await rendered.json()).toMatchObject({ subject: 'Admin saved revision', body: 'Hello Synthetic agent preview, this is a saved synthetic CRM template.',
      template: { email_design: { layout: 'welcome', brand_name: 'Synthetic Agency', heading: 'Welcome to Synthetic Agency' } } });
    await test.step('Use the persisted revision in a second agent composer', async () => {
      const agentPage = await context.newPage();
      await agentPage.setExtraHTTPHeaders(headers);
      await agentPage.route('**/api/sales-templates**', (route) => route.continue());
      await agentPage.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
        key: 'unmatched:synthetic@example.test', kind: 'unmatched', client_id: null, lead_id: null, name: 'Synthetic preview',
        email: 'synthetic@example.test', address: 'synthetic@example.test', can_email: true, href: '', total: 1, unread: 0,
      }] } }));
      await agentPage.goto('/communication');
      await agentPage.locator('[data-conversation-key]').filter({ hasText: 'Synthetic preview' }).click();
      await agentPage.getByRole('button', { name: 'Sales templates', exact: true }).click();
      const picker = agentPage.getByRole('dialog', { name: 'Sales templates', exact: true });
      await picker.getByLabel('Choose sales template').selectOption(templateId);
      await picker.getByRole('textbox', { name: 'contact name', exact: true }).fill('Synthetic agent preview');
      await picker.getByRole('checkbox').check();
      await picker.getByRole('button', { name: 'Use template', exact: true }).click();
      await expect(agentPage.getByPlaceholder('Subject', { exact: true })).toHaveValue('Admin saved revision');
      await expect(agentPage.getByPlaceholder('Email Synthetic preview…', { exact: true })).toHaveValue('Hello Synthetic agent preview, this is a saved synthetic CRM template.');
      await agentPage.close();
    });
    const conflictStarted = Date.now();
    expect((await context.request.patch('/api/sales-templates', { data: { ...saved, revision: 1 } })).status()).toBe(409);
    expect(Date.now() - conflictStarted, 'Stale edits return a prompt conflict without transaction retries').toBeLessThan(5000);
  } finally {
    const cleanup = [];
    if (templateId) {
      cleanup.push(await db.from('sales_template_revisions').delete().eq('template_id', templateId));
      cleanup.push(await db.from('sales_templates').delete().eq('id', templateId));
    }
    cleanup.push(await db.from('agency_members').update({ role: 'owner' }).eq('user_id', owner.id));
    if (secondId) {
      cleanup.push(await db.from('agency_members').delete().eq('user_id', secondId));
      const removed = await db.auth.admin.deleteUser(secondId);
      if (removed.error) throw new Error('Second synthetic agent cleanup failed');
    }
    if (cleanup.some((result) => result.error)) throw new Error('Synthetic template cleanup failed');
  }
});
