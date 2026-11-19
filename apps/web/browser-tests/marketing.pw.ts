import { test, expect, leadId } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { EMPTY_MARKETING_PROFILE } from '@crm/shared';
import path from 'node:path';

test.setTimeout(90000);

test('marketing profile and selected purpose persist without invoking AI or sending', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  await page.getByLabel('Stated insurance interests', { exact: true }).fill('Commercial auto');
  await page.getByLabel('Priorities / what matters most', { exact: true }).fill('Keep the process simple');
  await page.getByLabel('Agreed next step', { exact: true }).fill('Request VIN by email');
  await page.getByLabel('Source (for example: customer call on Nov 2)', { exact: true }).fill('Customer call');
  await page.getByLabel('Last confirmed', { exact: true }).fill('2026-10-30');
  await page.getByRole('combobox', { name: 'Preferred next-step channel', exact: true }).selectOption('email');
  await page.getByRole('combobox', { name: 'Default email purpose', exact: true }).selectOption('missing_information');
  await page.getByRole('button', { name: 'Save marketing profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Marketing profile saved.' })).toBeVisible();
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Marketing profile & email purpose', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Stated insurance interests', exact: true })).toHaveValue('Commercial auto');
  await expect(page.getByRole('combobox', { name: 'Default email purpose', exact: true })).toHaveValue('missing_information');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save marketing profile', exact: true })).toBeVisible();
  expect(data.marketingProfiles.size).toBe(1);
  expect(data.requests.some((request) => request.includes('/api/ai/') || request.endsWith('/draft-outreach') || request.includes('/outreach/run'))).toBe(false);
});

test('shared sender settings live in owner Settings and remain accessible at mobile width', async ({ page, context, data }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for owner-settings verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const account = await context.request.get('/api/account');
  expect(account.status()).toBe(200);
  const identity = await account.json() as { email: string };
  if (!identity.email.startsWith('crm-browser-') || !identity.email.endsWith('@example.invalid')) throw new Error('Only the disposable browser account may receive the temporary QA role.');
  let userId: string | null = null;
  for (let pageNumber = 1; !userId; pageNumber++) {
    const users = await admin.auth.admin.listUsers({ page: pageNumber, perPage: 100 });
    if (users.error) throw new Error('Unable to find the temporary browser account.');
    const match = users.data.users.find((user) => user.email === identity.email && user.user_metadata.crm_browser_qa === true);
    if (match) userId = match.id;
    if (users.data.users.length < 100) break;
  }
  if (!userId) throw new Error('Temporary browser account could not be verified.');
  const membership = await admin.from('agency_members').insert({ user_id: userId, email: identity.email, role: 'owner' });
  if (membership.error) throw new Error('Unable to create the temporary owner-settings verification membership.');
  try {
  const liveEmail = await context.request.get('/api/settings/email');
  expect(liveEmail.status(), await liveEmail.text()).toBe(200);
  expect(await liveEmail.json()).toMatchObject({ domainStatus: 'verified', sendingEnabled: true, issues: [] });
  const liveSender = await context.request.get('/api/settings/outreach');
  expect(liveSender.status(), await liveSender.text()).toBe(200);
  const liveSenderData = await liveSender.json() as { revision: number; settings: { sender_profile: { name: string; role: string } }; sender_options: { name: string[]; role: string[] } };
  expect(liveSenderData.sender_options.name).toContain(liveSenderData.settings.sender_profile.name);
  expect(liveSenderData.sender_options.role).toContain(liveSenderData.settings.sender_profile.role);
  const liveAutomation = await context.request.get('/api/settings/automation');
  expect(liveAutomation.status(), await liveAutomation.text()).toBe(200);
  expect(liveAutomation.headers()['cache-control']).toContain('no-store');
  expect(await liveAutomation.json()).toMatchObject({
    revision: liveSenderData.revision,
    configuration: { outreach: liveSenderData.settings },
    execution_policy: { custom_rules: 'supported_events_and_guarded_actions', automated_sms: 'unavailable' },
    history: expect.arrayContaining([expect.objectContaining({ revision: liveSenderData.revision })]),
  });
  data.outreachSettings.sender_profile.specialties = 'Commercial\nPersonal';
  await page.route('**/api/agency?team=true', (route) => route.fulfill({ json: {
    member: { user_id: userId, email: identity.email, role: 'owner', active: true },
    members: [], enabled: false, can_invite: false, issues: ['Configure multi-agent access before inviting members.'],
  } }));
  await page.goto('/settings?tab=email', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Email', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Business configuration and operational controls', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Configuration presence is not proof of delivery.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Agency sender profile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send test & verify replies', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send test & verify replies', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Test accepted. Reply to it, then refresh status.');
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save permission', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send test & verify replies', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await expect(page.getByText('Invitations need setup before you can add a member.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save permission', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Automation & Outreach', exact: true }).click();
  await expect(page).toHaveURL(/tab=automation/);
  await expect(page.getByRole('button', { name: 'Edit First contact', exact: true })).toBeVisible();
  await page.getByLabel('Due hour - Arizona', { exact: true }).fill('14');
  await page.getByRole('button', { name: 'Save automation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Automation settings saved.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Due hour - Arizona', { exact: true })).toHaveValue('14');
  await page.getByLabel('Due hour - Arizona', { exact: true }).fill('13');
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await page.getByRole('tab', { name: 'Automation & Outreach', exact: true }).click();
  await expect(page.getByLabel('Due hour - Arizona', { exact: true })).toHaveValue('13');
  await expect(page.getByRole('tab', { name: 'Automation & Outreach', exact: true })).toHaveAttribute('aria-selected', 'true');
  data.outreachRevision++;
  await page.getByRole('button', { name: 'Save automation', exact: true }).click();
  await expect(page.getByRole('tabpanel').getByRole('alert')).toHaveText('Settings changed since you opened them. Reload before saving.');
  await expect(page.getByLabel('Due hour - Arizona', { exact: true })).toHaveValue('13');
  page.once('dialog', (dialog) => { void dialog.dismiss(); });
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(page.getByLabel('Due hour - Arizona', { exact: true })).toHaveValue('13');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(page.getByLabel('Due hour - Arizona', { exact: true })).toHaveValue('14');
  await page.getByRole('button', { name: 'Edit Incoming replies', exact: true }).click();
  await page.getByLabel('Reply target - minutes', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Save automation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Automation settings saved.');
  expect(data.automationConfiguration.reply.due_minutes).toBe(45);
  await page.getByRole('link', { name: 'Sequences', exact: true }).click();
  await page.getByLabel('Emails per new sequence', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save automation', exact: true }).click();
  await expect(page.getByText('Automation settings saved.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sender', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Agency sender profile', exact: true })).toBeVisible();
  await expect(page.getByLabel('Producer name', { exact: true })).toHaveJSProperty('tagName', 'INPUT');
  await expect(page.getByLabel('Job title', { exact: true })).toHaveJSProperty('tagName', 'SELECT');
  await expect(page.getByLabel('Job title', { exact: true }).getByRole('option', { name: 'Account manager', exact: true })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Agency sender profile', exact: true }).locator('textarea:visible')).toHaveCount(2);
  await expect(page.getByLabel('Specialties', { exact: true })).toHaveValue('Commercial\nPersonal');
  await page.getByLabel('Producer name', { exact: true }).fill('Taylor');
  await page.getByLabel('Job title', { exact: true }).selectOption({ label: 'Account manager' });
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Job title', { exact: true })).toHaveValue('title:Account manager');
  expect(data.accountProfile.role).toBe('agent');
  await page.getByLabel('Job title', { exact: true }).selectOption({ label: 'Other / custom title' });
  await page.getByLabel('Custom job title', { exact: true }).fill('Licensed commercial producer');
  await page.getByRole('textbox', { name: 'Signature', exact: true }).fill('Taylor\nShield Assurance');
  await page.getByLabel('Writing style', { exact: true }).fill('Warm, clear and concise.');
  await expect(page.getByRole('complementary', { name: 'Signature preview', exact: true })).toContainText('Taylor\nShield Assurance');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Automation & Outreach', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByLabel('Producer name', { exact: true })).toHaveValue('Taylor');
  await expect(page.getByLabel('Job title', { exact: true })).toHaveValue('title:Licensed commercial producer');
  await expect(page.getByLabel('Job title', { exact: true }).getByRole('option', { name: 'Licensed commercial producer', exact: true })).toHaveCount(1);
  data.outreachRevision++;
  await page.getByLabel('Agency', { exact: true }).fill('Unsaved agency change');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('tabpanel').getByRole('alert')).toHaveText('Settings changed since you opened them. Reload before saving.');
  await expect(page.getByLabel('Agency', { exact: true })).toHaveValue('Unsaved agency change');
  page.once('dialog', (dialog) => { void dialog.dismiss(); });
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(page.getByLabel('Agency', { exact: true })).toHaveValue('Unsaved agency change');
  await expect(page.getByRole('tabpanel').getByRole('alert')).toBeVisible();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(page.getByLabel('Agency', { exact: true })).toHaveValue('Shield Assurance');
  await expect(page.getByRole('tabpanel').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Signature', exact: true })).toHaveValue('Taylor\nShield Assurance');
  await expect(page.getByLabel('Specialties', { exact: true })).toHaveValue('Commercial\nPersonal');
  await page.getByLabel('Specialties', { exact: true }).fill('Commercial, personal');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  const desktopInput = await page.getByLabel('Producer name', { exact: true }).boundingBox();
  expect(desktopInput?.height).toBe(36);
  await page.getByLabel('Producer name', { exact: true }).scrollIntoViewIfNeeded();
  const saveButton = await page.getByRole('button', { name: 'Save settings', exact: true }).boundingBox();
  if (process.env.CRM_DESIGN_OUTPUT_DIR) {
    await page.screenshot({ path: path.join(process.env.CRM_DESIGN_OUTPUT_DIR, 'sender-pilot-desktop.png'), fullPage: true });
  }
  expect((saveButton?.y ?? Infinity) + (saveButton?.height ?? 0)).toBeLessThanOrEqual(768);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).not.toBeVisible();
  await page.getByLabel('Producer name', { exact: true }).scrollIntoViewIfNeeded();
  expect((await page.getByLabel('Producer name', { exact: true }).boundingBox())?.height).toBe(44);
  expect(await page.getByRole('group', { name: 'Agency sender profile', exact: true }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (process.env.CRM_DESIGN_OUTPUT_DIR) {
    await page.screenshot({ path: path.join(process.env.CRM_DESIGN_OUTPUT_DIR, 'sender-pilot-mobile.png'), fullPage: true });
  }
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause background scheduling', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Not run yet', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('0 records to inspect. Internal work only; no email or AI.', { exact: true })).toBeVisible();
  expect(data.requests.filter((request) => request.startsWith('POST /api/automation/run'))).toHaveLength(0);
  page.once('dialog', (dialog) => { void dialog.dismiss(); });
  await page.getByRole('button', { name: 'Run this job', exact: true }).click();
  expect(data.requests.filter((request) => request.startsWith('POST /api/automation/run'))).toHaveLength(0);
  data.outreachRevision++;
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Run this job', exact: true }).click();
  await expect(page.getByRole('tabpanel').getByRole('alert')).toHaveText('Settings changed after preview. Preview this job again.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Run this job', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Run finished.');
  await page.getByRole('button', { name: 'Pause background scheduling', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Background scheduling paused. Existing work is preserved.');
  expect(data.schedulerEnabled).toBe(false);
  await page.getByRole('tab', { name: 'Automation & Outreach', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Email', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send test & verify replies', exact: true })).toBeVisible();
  expect(data.outreachSettings.sender_profile.name).toBe('Taylor');
  expect(data.requests.some((request) => request.includes('/api/ai/') || request.includes('/outreach/run'))).toBe(false);
  } finally {
    const removed = await admin.from('agency_members').delete().eq('user_id', userId);
    if (removed.error) throw new Error('Unable to remove the temporary owner-settings membership.');
  }
});

test('profile menu opens personal My Account without agency configuration', async ({ page, data }) => {
  await page.goto('/outreach', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('link', { name: 'My Account', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'My Account', exact: true })).toBeVisible();
  await page.getByLabel('Display name', { exact: true }).fill('My updated name');
  await page.getByLabel('Contact phone', { exact: true }).fill('555-0100');
  await page.getByRole('button', { name: 'Save my profile', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your account was saved.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('My updated name');
  await expect(page.getByLabel('Agency role', { exact: true })).toHaveValue('agent');
  await expect(page.getByRole('heading', { name: 'Agency sender profile', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save my profile', exact: true })).toBeVisible();
  expect(data.accountProfile.full_name).toBe('My updated name');
  expect(data.requests.some((request) => request.startsWith('PATCH /api/settings/'))).toBe(false);
});

test('unassigned account cannot view agency configuration', async ({ page, context }) => {
  const automation = await context.request.get('/api/settings/automation');
  expect(automation.status()).toBe(403);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Agency settings are owner-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
});

test('real personal profile API persists only the temporary signed-in account', async ({ context }) => {
  const before = await context.request.get('/api/account');
  expect(before.status()).toBe(200);
  const profile = await before.json() as { email: string; full_name: string; contact_phone: string };
  if (!profile.email.startsWith('crm-browser-') || !profile.email.endsWith('@example.invalid')) throw new Error('Profile persistence QA must use the temporary browser account.');
  try {
    const saved = await context.request.patch('/api/account', { data: { full_name: 'Personal profile persistence QA', contact_phone: '555-0100' } });
    expect(saved.status(), await saved.text()).toBe(200);
    const reloaded = await context.request.get('/api/account');
    expect(await reloaded.json()).toMatchObject({ email: profile.email, full_name: 'Personal profile persistence QA', contact_phone: '555-0100' });
    const denied = await context.request.patch('/api/account', { data: { full_name: 'No escalation', contact_phone: '', role: 'owner' } });
    expect(denied.status()).toBe(400);
    expect((await (await context.request.get('/api/settings/outreach')).json()).message).toContain('Only the agency owner');
  } finally {
    const restored = await context.request.patch('/api/account', { data: { full_name: profile.full_name, contact_phone: profile.contact_phone } });
    expect(restored.status(), 'Restore the temporary account profile').toBe(200);
  }
});

test('real authenticated profile API persists linked-account preferences using disposable QA records', async ({ context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for persistence verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientId = randomUUID();
  const qaLeadId = randomUUID();
  const profile = {
    ...EMPTY_MARKETING_PROFILE, interests: 'Commercial auto', priorities: 'Email follow-up',
    source: 'Disposable QA fixture', confirmed_on: '2026-10-30',
  };
  try {
    const client = await admin.from('clients').insert({ id: clientId, full_name: 'Disposable marketing QA account' });
    if (client.error) throw new Error(client.error.message);
    const lead = await admin.from('leads').insert({ id: qaLeadId, account_id: clientId, full_name: 'Disposable marketing QA lead', source: 'marketing_qa', status: 'new' });
    if (lead.error) throw new Error(lead.error.message);
    const saved = await context.request.put(`/api/outreach/profile?record_type=lead&record_id=${qaLeadId}`, { data: { profile } });
    expect(saved.status(), await saved.text()).toBe(200);
    const reloaded = await context.request.get(`/api/outreach/profile?record_type=client&record_id=${clientId}`);
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toEqual({ profile });
    const rows = await admin.from('outreach_marketing_profiles').select('client_id,lead_id,profile').eq('client_id', clientId);
    if (rows.error) throw new Error(rows.error.message);
    expect(rows.data).toEqual([{ client_id: clientId, lead_id: null, profile }]);
    const outbox = await admin.from('outreach_outbox').select('id').eq('lead_id', qaLeadId);
    if (outbox.error) throw new Error(outbox.error.message);
    expect(outbox.data).toEqual([]);
    const settings = await context.request.get('/api/outreach');
    expect(settings.status()).toBe(200);
    expect((await settings.json()).settings.sender_profile).toHaveProperty('signature');
  } finally {
    const profiles = await admin.from('outreach_marketing_profiles').delete().eq('client_id', clientId);
    const lead = await admin.from('leads').delete().eq('id', qaLeadId);
    const client = await admin.from('clients').delete().eq('id', clientId);
    const failures = [profiles.error, lead.error, client.error].filter(Boolean);
    if (failures.length) throw new Error(`Marketing QA cleanup failed: ${failures.map((error) => error?.message).join('; ')}`);
  }
});
