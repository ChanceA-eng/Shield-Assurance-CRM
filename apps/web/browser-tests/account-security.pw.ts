import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

interface Account { id: string; email: string; password: string; context: BrowserContext }
const test = base.extend<{ account: Account; owner: Account; admin: SupabaseClient }>({
  admin: async ({}, use) => {
    if (process.env.CRM_BROWSER_QA_ALLOWED !== '1') throw new Error('Disposable account QA requires explicit CRM_BROWSER_QA_ALLOWED=1.');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase service configuration required.');
    await use(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  },
  account: async ({ browser, baseURL, storageState, admin }, use) => {
    await withAccount('agent', browser, baseURL, storageState, admin, use);
  },
  owner: async ({ browser, baseURL, storageState, admin }, use) => {
    await withAccount('owner', browser, baseURL, storageState, admin, use);
  },
});
async function withAccount(role: 'agent' | 'owner', browser: Browser,
  baseURL: string | undefined, storageState: BrowserContextOptions['storageState'],
  admin: SupabaseClient, use: (account: Account) => Promise<void>): Promise<void> {
  const email = `crm-account-qa-${randomUUID()}@example.invalid`;
  const password = `QA-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Account QA', crm_account_qa: true } });
  if (created.error || !created.data.user) throw new Error(`Disposable account creation failed: ${created.error?.code}: ${created.error?.message}`);
  const id = created.data.user.id;
  const context = await browser.newContext({ baseURL, storageState });
  try {
    const member = await admin.from('agency_members').insert({ user_id: id, email, role, active: true });
    if (member.error) throw new Error(member.error.message);
    await signInContext(context, baseURL!, email, password);
    await use({ id, email, password, context });
  } finally {
    await context.close();
    for (const result of [
      await admin.from('account_email_changes').delete().or(`user_id.eq.${id},approved_by.eq.${id}`),
      await admin.from('agency_audit').delete().or(`actor_id.eq.${id},target_id.eq.${id}`),
      await admin.from('agency_members').delete().eq('user_id', id),
    ]) if (result.error) throw new Error(`Disposable account dependency cleanup failed: ${result.error.message}`);
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) throw new Error(`Disposable account cleanup failed: ${id}: ${removed.error.code}`);
  }
}
async function signInContext(context: BrowserContext, baseURL: string, email: string, password: string): Promise<void> {
    const cookies: Array<{ name: string; value: string }> = [];
    const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: {
      getAll: () => cookies,
      setAll: (values) => { for (const value of values) { const i = cookies.findIndex((cookie) => cookie.name === value.name); if (i >= 0) cookies.splice(i, 1); cookies.push({ name: value.name, value: value.value }); } },
    } });
    const signed = await auth.auth.signInWithPassword({ email, password });
    if (signed.error) throw new Error('Disposable sign-in failed.');
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, domain: new URL(baseURL).hostname, path: '/', httpOnly: false, secure: baseURL.startsWith('https:'), sameSite: 'Lax' })));
}
test.setTimeout(90000);

test('real own-Gmail and task metrics APIs remain available without connecting or sending', async ({ account }) => {
  const gmail = await account.context.request.get('/api/gmail');
  expect(gmail.status(), await gmail.text()).toBe(200);
  expect(await gmail.json()).toMatchObject({ connection: null });
  const metrics = await account.context.request.get('/api/metrics/tasks');
  expect(metrics.status(), await metrics.text()).toBe(200);
  const data: Record<string, unknown> = await metrics.json();
  for (const key of ['on_time', 'overdue', 'unclassified']) {
    expect(Number.isInteger(data[key])).toBe(true);
    expect(Number(data[key])).toBeGreaterThanOrEqual(0);
  }
});

test('real account tabs retain drafts, persist profile and personal signature, and fit mobile', async ({ account }) => {
  const page = await account.context.newPage();
  await page.goto('/account');
  await page.getByLabel('Display name', { exact: true }).fill('QA updated name');
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await expect(page.getByText('Request owner approval', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('QA updated name');
  await page.getByRole('button', { name: 'Save my profile', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your account was saved.');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByText('QA updated name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('tab', { name: 'Signature / Mailbox', exact: true }).click();
  const gmail = await account.context.request.get('/api/gmail');
  expect(gmail.status(), await gmail.text()).toBe(200);
  await expect(page.getByText('Personal Gmail sending', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Gmail', exact: true })).toBeVisible();
  await page.getByLabel('Signature', { exact: true }).fill('QA agent\nShield Assurance');
  const saving = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/account' && request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Save my signature', exact: true }).click();
  expect((await saving).postDataJSON()).toEqual({ signature: 'QA agent\nShield Assurance' });
  await expect(page.getByRole('status').filter({ hasText: 'Your signature was saved.' })).toBeVisible();
  expect(await (await account.context.request.get('/api/account')).json()).toMatchObject({ signature: 'QA agent\nShield Assurance' });
  await page.reload();
  await expect(page.getByLabel('Signature', { exact: true })).toHaveValue('QA agent\nShield Assurance', { timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save my signature', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Signature / Mailbox', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('personal Gmail retains connected status on refresh failure and offers send-only reconnection', async ({ account }) => {
  const page = await account.context.newPage();
  let failure = false, status = 'connected';
  await page.route('**/api/gmail', (route) => route.fulfill(failure
    ? { status: 503, json: { message: 'Connection status temporarily unavailable.' } }
    : { json: { connection: { email: 'qa@example.invalid', sync_enabled: false, status, last_error: null }, default_provider: 'resend' } }));
  await page.goto('/account?tab=signature');
  await expect(page.getByText('qa@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Signature', { exact: true })).toBeVisible();
  failure = true;
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await expect(page.getByText('qa@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Gmail', exact: true })).toHaveCount(0);
  failure = false; status = 'reconnect';
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reconnect Gmail', exact: true })).toBeVisible();
});

test('real password change requires the old password and persists a usable new password', async ({ account }) => {
  const endpoint = '/api/account/password';
  const next = `New-${randomUUID()}!`;
  expect((await account.context.request.post(endpoint, { data: { current_password: 'wrong-password', password: next, confirm_password: next } })).status()).toBe(403);
  expect((await account.context.request.post(endpoint, { data: { current_password: account.password, password: next, confirm_password: 'mismatch' } })).status()).toBe(400);
  const changed = await account.context.request.post(endpoint, { data: { current_password: account.password, password: next, confirm_password: next } });
  expect(changed.status(), await changed.text()).toBe(200);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await anon.auth.signInWithPassword({ email: account.email, password: account.password })).error).not.toBeNull();
  expect((await anon.auth.signInWithPassword({ email: account.email, password: next })).error).toBeNull();
  await anon.auth.signOut();
});

test('agent email changes require owner approval and both independent proofs before provider identity changes', async ({ account, owner, admin, baseURL }) => {
  const next = `crm-account-changed-${randomUUID()}@example.invalid`;
  const changed = await account.context.request.post('/api/account/email', { data: { action: 'request', email: next, current_password: account.password } });
  expect(changed.status(), await changed.text()).toBe(200);
  const row = await admin.from('account_email_changes').select('id,status').eq('user_id', account.id).single();
  expect(row.data?.status).toBe('pending');
  const bypass = await admin.auth.admin.updateUserById(account.id, { email: next, email_confirm: true });
  expect(bypass.error).not.toBeNull();
  expect((await account.context.request.post('/api/settings/account-email', { data: { id: row.data!.id, approve: true } })).status()).toBe(403);
  const queue = await owner.context.request.get('/api/settings/account-email');
  expect(queue.status()).toBe(200);
  const ownerPage = await owner.context.newPage();
  await ownerPage.goto('/settings?tab=team');
  const approvalRow = ownerPage.getByText(`${account.email} \u2192 ${next}`, { exact: true }).locator('..');
  await expect(approvalRow).toBeVisible();
  await approvalRow.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(ownerPage.getByRole('status')).toContainText('Approved.');
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
  const seeded = await admin.from('account_email_changes').update({ old_token_hash: hash(tokens[0]), new_token_hash: hash(tokens[1]) }).eq('id', row.data!.id);
  expect(seeded.error).toBeNull();
  const confirm = (token: string) => account.context.request.post('/api/auth/confirm', { data: { type: 'email_change', token_hash: token } });
  expect((await confirm(tokens[0])).status()).toBe(200);
  expect((await admin.auth.admin.getUserById(account.id)).data.user?.email).toBe(account.email);
  expect((await confirm(tokens[0])).status()).toBe(400);
  const finished = await confirm(tokens[1]);
  expect(finished.status(), await finished.text()).toBe(200);
  expect((await admin.auth.admin.getUserById(account.id)).data.user?.email).toBe(next);
  expect((await admin.from('agency_members').select('email,role').eq('user_id', account.id).single()).data).toEqual({ email: next, role: 'agent' });
  expect((await admin.from('account_email_changes').select('status').eq('id', row.data!.id).single()).data?.status).toBe('completed');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await anon.auth.signInWithPassword({ email: next, password: account.password })).error).toBeNull();
  await anon.auth.signOut({ scope: 'local' });
  await signInContext(account.context, baseURL!, next, account.password);
  for (const [actor, role] of [[account, 'admin'], [owner, 'owner']] as const) {
    if (role === 'admin') expect((await admin.from('agency_members').update({ role }).eq('user_id', actor.id)).error).toBeNull();
    const request = await actor.context.request.post('/api/account/email', { data: {
      action: 'request', email: `crm-selfchange-${randomUUID()}@example.invalid`, current_password: actor.password,
    } });
    expect(request.status(), await request.text()).toBe(200);
    const saved = await admin.from('account_email_changes').select('status,approved_by').eq('user_id', actor.id).eq('status', 'approved').single();
    expect(saved.data).toEqual({ status: 'approved', approved_by: actor.id });
    expect((await actor.context.request.post('/api/account/email', { data: { action: 'cancel', current_password: actor.password } })).status()).toBe(200);
  }
});

test('password recovery requires explicit confirmation, creates a bound session and saves the new password', async ({ account, admin, browser, baseURL, storageState }) => {
  const generated = await admin.auth.admin.generateLink({ type: 'recovery', email: account.email });
  expect(generated.error).toBeNull();
  const context = await browser.newContext({ baseURL, storageState });
  try {
    const page = await context.newPage();
    await page.goto(`/auth/confirm#type=recovery&token_hash=${generated.data.properties!.hashed_token}`);
    expect(await context.cookies()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'crm_recovery' })]));
    await page.getByRole('button', { name: 'Confirm and continue', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/recovery$/, { timeout: 15000 });
    expect((await context.cookies()).find((cookie) => cookie.name === 'crm_recovery')?.httpOnly).toBe(true);
    const password = `Reset-${randomUUID()}`;
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save new password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Password changed', { timeout: 15000 });
    expect((await context.cookies()).some((cookie) => cookie.name === 'crm_recovery')).toBe(false);
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.auth.signInWithPassword({ email: account.email, password })).error).toBeNull();
    await anon.auth.signOut();
  } finally { await context.close(); }
});

test('forgot password keeps email visible, and account mutations reject cross-site JSON', async ({ browser, baseURL, storageState, account }) => {
  const context = await browser.newContext({ baseURL, storageState });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send reset link', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    expect((await account.context.request.patch('/api/account', { headers: { Origin: 'https://other.invalid' }, data: { signature: 'unwanted' } })).status()).toBe(403);
  } finally { await context.close(); }
});
