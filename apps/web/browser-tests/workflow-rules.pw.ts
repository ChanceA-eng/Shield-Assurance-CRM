import { test, expect } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { isRecord, isUuid } from '../src/lib/workspace-validation';

test.setTimeout(90000);
test.use({ actionTimeout: 10000 });
test('owner custom rules persist, retain stale edits and fit mobile without executing business work', async ({ page, context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for live workflow configuration verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const account = await context.request.get('/api/account');
  expect(account.status()).toBe(200);
  const identity: unknown = await account.json();
  if (!isRecord(identity) || typeof identity.email !== 'string' || !identity.email.startsWith('crm-browser-')
    || !identity.email.endsWith('@example.invalid')) throw new Error('Only the verified disposable browser identity may become a QA owner.');
  let userId: string | null = null;
  for (let number = 1; ; number++) {
    const users = await admin.auth.admin.listUsers({ page: number, perPage: 100 });
    if (users.error) throw users.error;
    const found = users.data.users.find((user) => user.email === identity.email && user.user_metadata.crm_browser_qa === true);
    if (found) { userId = found.id; break; }
    if (users.data.users.length < 100) break;
  }
  if (!userId) throw new Error('The disposable workflow owner could not be verified.');
  const membership = await admin.from('agency_members').insert({ user_id: userId, email: identity.email, role: 'owner' });
  if (membership.error) throw membership.error;
  const name = `Workflow QA ${userId.slice(0, 8)}`;
  try {
    await context.unroute('**/api/**');
    await page.goto('/settings?tab=automation&section=rules&rules=custom', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Rule name', { exact: true }).fill(name);
    await page.getByLabel('Task title', { exact: true }).fill('Review {{name}}');
    await page.getByLabel('Due after - minutes', { exact: true }).fill('15');
    await page.getByRole('combobox', { name: 'Task assignee', exact: true }).selectOption(userId);
    await page.getByText('Conditions', { exact: true }).click();
    await page.getByLabel('Sources', { exact: true }).fill(`workflow-browser-${userId}`);
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`"${name}" saved - revision 1. Paused.`);
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(name);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(name);
    await expect(page.getByLabel('Due after - minutes', { exact: true })).toHaveValue('15');
    await expect(page.getByRole('combobox', { name: 'Task assignee', exact: true })).toHaveValue(userId);
    const ruleId = new URL(page.url()).searchParams.get('rule');
    if (!isUuid(ruleId)) throw new Error('The saved rule URL did not retain its actual identity.');
    const current = await context.request.get(`/api/settings/automation/rules?rule=${ruleId}`);
    expect(current.status()).toBe(200);
    const snapshot: unknown = await current.json();
    if (!isRecord(snapshot) || !isRecord(snapshot.selected_rule) || !isRecord(snapshot.selected_rule.definition)) throw new Error('Saved workflow snapshot missing.');
    await page.getByLabel('Rule name', { exact: true }).fill(`${name} unsaved`);
    const changed = await context.request.post('/api/settings/automation/rules', {
      data: { rule_id: ruleId, expected_revision: 1, definition: { ...snapshot.selected_rule.definition, name: `${name} updated` } },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This rule changed.' })).toBeVisible();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(`${name} unsaved`);
    page.once('dialog', (dialog) => { void dialog.dismiss(); });
    await page.getByRole('button', { name: 'Reload saved rule', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(`${name} unsaved`);
    page.once('dialog', (dialog) => { void dialog.dismiss(); });
    await page.getByRole('link', { name: 'Built-in rules', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(`${name} unsaved`);
    await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
    await page.getByRole('tab', { name: 'Automation & Outreach', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(`${name} unsaved`);
    page.once('dialog', (dialog) => { void dialog.accept(); });
    await page.getByRole('button', { name: 'Reload saved rule', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(`${name} updated`);
    await page.getByLabel('Enabled for new events', { exact: true }).check();
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('revision 3. New events only.');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).not.toBeVisible();
    await page.getByRole('combobox', { name: 'When', exact: true }).selectOption('website.submitted');
    await page.getByRole('combobox', { name: 'Then', exact: true }).selectOption('draft_sequence');
    await expect(page.getByLabel('Task title', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Then', exact: true }).locator('option')).toHaveText([
      'Create task', 'Agency notification', 'Add account or lead note',
      'Enroll in outreach - no first draft', 'Enroll and draft - manual approval',
    ]);
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('revision 4. New events only.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByRole('combobox', { name: 'Then', exact: true }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const runs = await admin.from('workflow_executions').select('id', { count: 'exact', head: true }).eq('rule_id', ruleId);
    if (runs.error) throw runs.error;
    expect(runs.count, 'Saving, enabling and editing a source-filtered rule must not execute historical records, draft or send').toBe(0);
    const history = await admin.from('workflow_rule_versions').select('revision').eq('rule_id', ruleId).order('revision');
    if (history.error) throw history.error;
    expect(history.data.map((version) => version.revision)).toEqual([1, 2, 3, 4]);
  } finally {
    const rules = await admin.from('workflow_rules').select('id,definition').eq('owner_id', userId);
    if (rules.error) throw rules.error;
    if (rules.data.some((rule) => !isRecord(rule.definition) || typeof rule.definition.name !== 'string' || !rule.definition.name.startsWith(name))) {
      throw new Error('Unexpected workflow ownership during cleanup; retained evidence rather than deleting unverified rules.');
    }
    const ids = rules.data.map((rule) => rule.id);
    if (ids.length) {
      const executions = await admin.from('workflow_executions').select('id').in('rule_id', ids);
      if (executions.error) throw executions.error;
      if (executions.data.length) throw new Error('Unexpected business executions during configuration-only QA; retained evidence for investigation.');
      const versions = await admin.from('workflow_rule_versions').delete().in('rule_id', ids);
      if (versions.error) throw versions.error;
      const removed = await admin.from('workflow_rules').delete().in('id', ids).eq('owner_id', userId);
      if (removed.error) throw removed.error;
    }
    const audit = await admin.from('agency_audit').delete().eq('actor_id', userId);
    if (audit.error) throw audit.error;
    const removed = await admin.from('agency_members').delete().eq('user_id', userId);
    if (removed.error) throw removed.error;
  }
});
