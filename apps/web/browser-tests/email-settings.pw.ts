import { test, expect } from './workspace-fixtures';
import { DEFAULT_OPPORTUNITY_SETTINGS } from '@crm/shared';

const owner = { user_id: 'cf98e001-b31a-4fbc-9eba-31ac9215d439', email: 'owner@example.invalid', role: 'owner', active: true };

test('Settings switches without server reloads, retains drafts and cached data, and supports browser Back', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let teamReads = 0;
  const serverNavigations: string[] = [];
  await page.route('**/api/agency?team=true', async (route) => {
    teamReads++;
    await route.fulfill({ json: { member: owner, members: [owner], enabled: true, can_invite: true, issues: [] } });
  });
  await page.goto('/settings');
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeEnabled();
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/settings' && (request.isNavigationRequest() || request.headers().rsc === '1')) serverNavigations.push(request.url());
  });
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await page.getByLabel('Recipient email', { exact: true }).fill('draft@example.invalid');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Marketing permission', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('draft@example.invalid');
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(teamReads).toBe(1);
  expect(serverNavigations).toEqual([]);
});

test('Invite member popup preserves failed invitations, retries and refreshes the member list', async ({ page, settingsOwner }) => {
  void settingsOwner;
  const members = [owner];
  const invitations: unknown[] = [];
  await page.route('**/api/agency**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/agency') return route.fallback();
    if (route.request().method() === 'POST') {
      invitations.push(route.request().postDataJSON());
      if (invitations.length === 1) return route.fulfill({ status: 503, json: { message: 'Invitation service unavailable. Try again.' } });
      members.push({ ...owner, user_id: 'cf98e001-b31a-4fbc-9eba-31ac9215d440', email: 'new-agent@example.invalid', role: 'agent' });
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    return route.fulfill({ json: { member: owner, members, enabled: true, can_invite: true, issues: [] } });
  });
  await page.goto('/settings?tab=team');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite member', exact: true });
  await dialog.getByLabel('Member email').fill('new-agent@example.invalid');
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  await dialog.getByLabel('Give this member access to agency customer records.').check();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Invitation service unavailable. Try again.');
  await expect(dialog.getByLabel('Member email')).toHaveValue('new-agent@example.invalid');
  page.once('dialog', (prompt) => void prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('new-agent@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeFocused();
  expect(invitations).toEqual(Array(2).fill({ email: 'new-agent@example.invalid', confirm_crm_access: true }));
});

test('disabled invitations explain the actual setup and never issue an invitation', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let reads = 0;
  let writes = 0;
  await page.route('**/api/agency?team=true', async (route) => {
    reads++;
    await route.fulfill({ json: { member: owner, members: [owner], enabled: false, can_invite: false,
      issues: ['Configure the CRM activation URL and allow it in the sign-in settings.'] } });
  });
  await page.route('**/api/agency', async (route) => { writes++; await route.fulfill({ status: 403, json: { message: 'Invitations disabled.' } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings?tab=team');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite member', exact: true });
  await expect(dialog).not.toContainText('Configure the CRM activation URL');
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check setup again' }).click();
  await expect.poll(() => reads).toBe(2);
  await dialog.getByRole('button', { name: 'Resolve setup with Rashi' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Rashi Assistant', { exact: true })).toBeVisible();
  await expect(page.getByText(/Configure the CRM activation URL/)).toBeVisible();
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('team-setup-mobile.png'), fullPage: true });
});

test('failed team loading has a working retry instead of an indefinite loading state', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let attempts = 0;
  await page.route('**/api/agency?team=true', async (route) => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { message: 'Team temporarily unavailable.' } });
    await route.fulfill({ json: { member: owner, members: [owner], enabled: true, can_invite: true, issues: [] } });
  });
  await page.goto('/settings?tab=team');
  await expect(page.getByRole('alert').filter({ hasText: 'Team temporarily unavailable.' })).toBeVisible();
  await expect(page.getByText('Loading members...', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry team' }).click();
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeEnabled();
  expect(attempts).toBe(2);
});

test('real owner team endpoint reports whether invitations are available and lists blockers without changing access', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const response = await context.request.get('/api/agency?team=true');
  expect(response.status(), await response.text()).toBe(200);
  const team: { can_invite: boolean; enabled: boolean; issues: string[]; members: unknown[] } = await response.json();
  expect(Array.isArray(team.members)).toBe(true);
  expect(team.can_invite).toBe(team.issues.length === 0);
  console.log(`Invitation availability: ${team.can_invite ? 'ready' : 'blocked'}. Setup steps: ${team.issues.length}. ${team.issues.join(' ')}`);
});

test('automation drafts survive visiting another Settings tab without refetching or server navigation', async ({ page, data, settingsOwner }) => {
  void settingsOwner;
  const serverNavigations: string[] = [];
  await page.goto('/settings?tab=automation&section=sender');
  await expect(page.getByLabel('Producer name', { exact: true })).toBeVisible();
  const reads = data.requests.filter((request) => request === 'GET /api/settings/outreach').length;
  await page.getByLabel('Producer name', { exact: true }).fill('Unfinished sender draft');
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/settings' && request.headers().rsc === '1') serverNavigations.push(request.url());
  });
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await page.getByRole('tab', { name: 'Automation & Outreach', exact: true }).click();
  await expect(page).toHaveURL(/section=sender/);
  await expect(page.getByLabel('Producer name', { exact: true })).toHaveValue('Unfinished sender draft');
  expect(data.requests.filter((request) => request === 'GET /api/settings/outreach')).toHaveLength(reads);
  expect(serverNavigations).toEqual([]);
});

test('discovery loads one tool at a time, retains edits and shows repairs rather than index dumps', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let researchReads = 0;
  let targetingReads = 0;
  let repaired = false;
  await page.route('**/api/intelligence/business-research-settings', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ action: 'retry_index', provider: 'irs', state: 'AZ' });
      repaired = true;
    } else researchReads++;
    await route.fulfill({ json: {
      settings: { enabled: false, tasks_enabled: false, task_capacity: 5, task_due_days: 3, refresh_days: 30, revision: 1 },
      sources: [], incomplete_jobs: [], partitions: [
        { provider: 'irs', state: 'AZ', status: repaired ? 'pending' : 'failed', cursor: 15, error: repaired ? null : 'Download failed. Retry this source.' },
        { provider: 'osm', state: 'AZ', status: 'complete', cursor: 90000, error: null },
      ],
    } });
  });
  await page.route('**/api/intelligence/operations', async (route) => {
    targetingReads++;
    await route.fulfill({ json: { settings: { config: DEFAULT_OPPORTUNITY_SETTINGS, revision: 1 } } });
  });
  await page.goto('/settings?tab=intelligence');
  await expect(page.getByRole('button', { name: 'Save research settings', exact: true })).toBeVisible();
  await expect(page.getByText('Directory indexes', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Source repairs' })).toContainText('IRS');
  await page.getByRole('button', { name: 'Retry source', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Source repairs' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Targeting', exact: true }).click();
  await page.getByLabel('Industries', { exact: true }).fill('Restaurants');
  const readsBeforeSwitching = targetingReads;
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await page.getByRole('tab', { name: 'Lead discovery', exact: true }).click();
  await expect(page.getByLabel('Industries', { exact: true })).toHaveValue('Restaurants');
  expect(researchReads).toBe(2);
  expect(targetingReads).toBe(readsBeforeSwitching);
  await expect(page.getByText('Source and processing availability', { exact: true })).toHaveCount(0);
});

test('integrations keep working controls and move setup details into Rashi', async ({ page, settingsOwner }) => {
  void settingsOwner;
  await page.route('**/api/settings/integrations', async (route) => route.fulfill({ json: { integrations: [
    { id: 'database', name: 'CRM database', state: 'healthy', detail: 'Connected and responding.' },
    { id: 'gmail', name: 'Agent Gmail', state: 'missing', detail: 'Configure GMAIL_PUBSUB_TOPIC in the deployment environment.' },
    { id: 'openai', name: 'AI assistance', state: 'missing', detail: 'Not configured.' },
    { id: 'resend', name: 'Email delivery', state: 'configured', detail: 'Verify the sending domain before sending.' },
  ] } }));
  await page.goto('/settings?tab=integrations');
  await expect(page.getByText(/Configure GMAIL_PUBSUB_TOPIC/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Help with Agent Gmail' }).click();
  await expect(page.getByText('Rashi Assistant', { exact: true })).toBeVisible();
  await expect(page.getByText(/Configure GMAIL_PUBSUB_TOPIC/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide Rashi', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Manage Gmail', exact: true })).toHaveAttribute('href', '/account?tab=signature');
  await page.getByRole('link', { name: 'Manage email', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Email', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Send test & verify replies', exact: true })).toBeVisible();
});

test('marketing permission failures preserve the administrator draft', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let submissions = 0;
  await page.route('**/api/email/consent', async (route) => {
    submissions += 1;
    if (submissions === 1) return route.fulfill({ status: 503, json: { message: 'Permission could not be saved. Please try again.' } });
    expect(route.request().postDataJSON()).toEqual({
      email: 'opted-in@example.invalid', source: 'Recipient checked marketing opt-in on November 3.', granted: true,
    });

    return route.fulfill({ json: { message: 'Marketing permission recorded.' } });
  });
  await page.goto('/settings?tab=permissions');
  const form = page.getByRole('button', { name: 'Save permission', exact: true });
  await expect(page.getByLabel('Permission', { exact: true })).toHaveValue('no');
  await page.getByLabel('Recipient email', { exact: true }).fill('opted-in@example.invalid');
  await page.getByLabel('Permission', { exact: true }).selectOption('yes');
  await page.getByLabel('How and when was permission given or withdrawn?').fill('Recipient checked marketing opt-in on November 3.');
  await form.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Permission could not be saved.' })).toHaveText('Permission could not be saved. Please try again.');
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('opted-in@example.invalid');
  await form.click();
  await expect(page.getByText('Marketing permission recorded.')).toBeVisible();
  expect(submissions).toBe(2);
});

test('settings and account tabs share the visual system and remain keyboard navigable', async ({ page, settingsOwner }) => {
  void settingsOwner;
  await page.goto('/settings?tab=permissions');
  const settingsTab = page.getByRole('tab', { name: 'Marketing permission', exact: true });
  const settingsStyle = await settingsTab.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
  });
  expect(settingsStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: test.info().outputPath('settings-desktop.png'), fullPage: true });
  await page.goto('/account?tab=profile');
  const accountTab = page.getByRole('tab', { name: 'Profile', exact: true });
  expect(await accountTab.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
  })).toEqual(settingsStyle);
  await accountTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Security', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-mobile.png'), fullPage: true });
});
