import { expect, test } from '@playwright/test';

const member = '44444444-4444-4444-8444-444444444444';
const challenge = 'a'.repeat(43);
const user = { id: member, email: 'pending@example.invalid', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: member, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;

test('opens, reloads and completes a challenge invitation without exposing it in the URL', async ({ page }) => {
  const claims: unknown[] = [];
  const actions: unknown[] = [];
  await page.route('**/api/auth/team-setup', async (route) => {
    claims.push(route.request().postDataJSON());
    await route.fulfill({ json: { token_hash: 'synthetic-proof' } });
  });

  await page.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/verify')) {
      expect(route.request().postDataJSON()).toMatchObject({ type: 'magiclink', token_hash: 'synthetic-proof' });
      await route.fulfill({ json: { access_token: accessToken, refresh_token: 'synthetic-refresh', token_type: 'bearer',
        expires_in: 3600, user } });
    } else if (url.pathname.endsWith('/user')) {
      await route.fulfill({ json: user });
    } else throw new Error(`Unexpected authentication call: ${url.pathname}`);
  });
  await page.route('**/api/agency?activation=true', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { needsActivation: true, challengeRequired: true } });
    else { actions.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); }
  });
  await page.route(/\/$/, async (route) => { await route.fulfill({ contentType: 'text/html', body: 'Setup complete' }); });
  await page.goto(`/auth/accept#type=invite&member=${member}&challenge=${challenge}`);
  await expect(page.getByLabel('New password')).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/accept$/);
  expect(claims).toEqual([{ member, challenge }]);
  await page.reload();
  await expect(page.getByLabel('New password')).toBeVisible();
  expect(claims).toHaveLength(1);
  await page.getByLabel('New password').fill('synthetic-password-123');
  await page.getByLabel('Phone number').fill('520-555-0101');
  await page.getByLabel('Mailing address').fill('Example address');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page.getByText('Setup complete')).toBeVisible();
  expect(actions).toContainEqual({ action: 'complete', challenge, phone: '520-555-0101', address: 'Example address' });
});

test('does not offer password setup to an already active account', async ({ page }) => {
  await page.route('**/api/agency?activation=true', async (route) => {
    await route.fulfill({ json: { needsActivation: false } });
  });
  await page.goto('/auth/accept');
  await expect(page.getByText('This account setup is already complete. Sign in to your account.')).toBeVisible();
  await expect(page.getByLabel('New password')).toHaveCount(0);
});
