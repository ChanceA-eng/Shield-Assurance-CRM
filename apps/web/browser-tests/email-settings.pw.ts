import { test, expect } from './workspace-fixtures';
import { DEFAULT_OPPORTUNITY_SETTINGS } from '@crm/shared';

const owner = { user_id: 'cf98e001-b31a-4fbc-9eba-31ac9215d439', email: 'owner@example.invalid', role: 'owner', active: true,
  role_title: null, team_name: null, direct_grants: null, setup_state: null, access_version: 1, invitation_id: null };
const teamResponse = (members: object[]) => ({ owner: true, managerGrants: null, members, invitationIssue: null, activity: [] });

test('Settings switches without server reloads, retains drafts and cached data, and supports browser Back', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let teamReads = 0;
  const serverNavigations: string[] = [];
  await page.route('**/api/agency?team=true', async (route) => {
    teamReads++;
    await route.fulfill({ json: teamResponse([owner]) });
  });
  await page.goto('/settings');
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Protected access', { exact: true }).first()).toBeVisible();
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/settings' && (request.isNavigationRequest() || request.headers().rsc === '1')) serverNavigations.push(request.url());
  });
  await page.getByRole('tab', { name: 'Marketing permission', exact: true }).click();
  await page.getByLabel('Recipient email', { exact: true }).fill('draft@example.invalid');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await expect(page.getByText('Protected access', { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Marketing permission', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('draft@example.invalid');
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(teamReads).toBe(0);
  expect(serverNavigations).toEqual([]);
});

test('Inline invitation preserves a failed draft, retries and refreshes the member list', async ({ page, settingsOwner }) => {
  void settingsOwner;
  const members: object[] = [owner];
  const invitations: unknown[] = [];
  await page.route('**/api/agency**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/agency') return route.fallback();
    if (route.request().method() === 'POST') {
      invitations.push(route.request().postDataJSON());
      if (invitations.length === 1) return route.fulfill({ status: 503, json: { message: 'Invitation service unavailable. Try again.' } });
      members.push({ ...owner, user_id: 'cf98e001-b31a-4fbc-9eba-31ac9215d440', email: 'new-agent@example.invalid', role: 'agent',
        role_title: 'Renewal Coordinator', team_name: 'New Member', active: false, setup_state: 'sent', direct_grants: { 'leads.view': 'assigned' } });
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    return route.fulfill({ json: teamResponse(members) });
  });
  await page.goto('/settings?tab=team');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('New Member');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('new-agent@example.invalid');
  await page.getByRole('textbox', { name: 'Role title', exact: true }).fill('Renewal Coordinator');
  const send = page.getByRole('button', { name: 'Send invite', exact: true });
  await expect(page.getByRole('checkbox', { name: 'View leads', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'View leads', exact: true }).check();
  await send.click();
  await expect(page.getByText('Invitation service unavailable. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('new-agent@example.invalid');
  await send.click();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('');
  await expect(page.getByText('new-agent@example.invalid', { exact: true })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'new-agent@example.invalid' });
  await row.getByRole('button', { name: 'Edit access' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit member access' })).toBeVisible();
  expect(invitations).toEqual(Array(2).fill({ action: 'invite', full_name: 'New Member', email: 'new-agent@example.invalid',
    role_title: 'Renewal Coordinator', grants: { 'leads.view': 'assigned' } }));
});

test('Team fits mobile and filters existing members without fetching the roster', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let reads = 0;
  await page.route('**/api/agency?team=true', async (route) => {
    reads++;
    await route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings?tab=team');
  const protectedAccess = page.getByText('Protected access', { exact: true });
  await expect(protectedAccess.first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search team' }).fill('absent-browser-qa@example.invalid');
  await expect(protectedAccess).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search team' }).clear();
  await expect(protectedAccess.first()).toBeVisible();
  expect(reads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('real owner team endpoint reports whether invitations are available and lists blockers without changing access', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const response = await context.request.get('/api/agency?team=true');
  expect(response.status(), await response.text()).toBe(200);
  const team: { owner: boolean; invitationIssue: string | null; members: unknown[] } = await response.json();
  expect(Array.isArray(team.members)).toBe(true);
  expect(team.owner).toBe(true);
  expect(team.invitationIssue === null || typeof team.invitationIssue === 'string').toBe(true);
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
