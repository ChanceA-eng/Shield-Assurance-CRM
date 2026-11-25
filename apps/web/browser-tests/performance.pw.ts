import { test, managerTest, expect } from './workspace-fixtures';

test('initial lead load uses one shell request and one pipeline read without duplicate badge calls', async ({ page, data }) => {
  const startedAt = performance.now();
  await page.goto('/leads');
  await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
  const pageTimings = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      responseStartMs: navigation?.responseStart ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      resources: performance.getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/api/'))
        .map((entry) => ({ path: new URL(entry.name).pathname, durationMs: Math.round(entry.duration) })),
    };
  });
  console.log('Local lead page load timing', JSON.stringify({
    headingVisibleMs: Math.round(performance.now() - startedAt),
    ...pageTimings,
  }));
  await expect.poll(() => data.requests.filter((item) => item === 'GET /api/shell').length).toBe(1);
  await expect.poll(() => data.requests.filter((item) => item === 'GET /api/leads').length).toBe(1);
  expect(data.requests.filter((item) => item === 'GET /api/notifications')).toHaveLength(0);
  expect(data.requests.filter((item) => item === 'GET /api/communication-log/unread')).toHaveLength(0);
  expect(data.requests.filter((item) => item === 'GET /api/communication-log/unread-by-lead')).toHaveLength(0);
});

test('login never starts protected background polling', async ({ page, data }) => {
  await page.context().clearCookies({ name: /^(?!_vercel_jwt$)/ });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'CRM Access Portal', exact: true })).toBeVisible();
  expect(data.requests.filter((item) => item === 'GET /api/shell')).toHaveLength(0);
  expect(data.requests.filter((item) => item === 'GET /api/leads/attention')).toHaveLength(0);
});

managerTest('dashboard renders metrics while the renewals request is still pending', async ({ page }) => {
  const startedAt = performance.now();
  let releaseRenewals!: () => void;
  const renewalsPending = new Promise<void>((resolve) => { releaseRenewals = resolve; });
  await page.route('**/api/dashboard**', async (route) => {
    const section = new URL(route.request().url()).searchParams.get('section');
    if (section === 'tasks') return route.fulfill({ json: { tasks: null } });
    if (section !== 'renewals') return route.fulfill({ json: {
      leads: { active: 9, conversion: 0.25, scope: 'agency' },
      policies: { total_written_premium: 125000, written_premium_series: [{ month: 'Nov', premium: 125000 }],
        renewals_30_days: 2, open_claims: 1 },
    } });
    await renewalsPending;
    await route.fulfill({ json: { renewals: [{
      id: 'renewal-1',
      insured_name: 'Example insured',
      carrier: 'Example carrier',
      line_of_business: 'Commercial',
      premium: 1250,
      renewal_date: '2026-11-20',
      expiration_date: null,
    }] } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('$125K', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading renewals...', { exact: true })).toBeVisible();
  const navigationTiming = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      responseStartMs: navigation?.responseStart ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
    };
  });
  console.log('Dashboard first metrics timing', JSON.stringify({
    metricsVisibleMs: Math.round(performance.now() - startedAt),
    ...navigationTiming,
  }));
  releaseRenewals();
  await expect(page.getByText('Example insured', { exact: true })).toBeVisible();
  await expect(page.locator('.recharts-surface')).toBeVisible();
});

test('account overview does not load full communication or hidden tabs until requested', async ({ page, data }) => {
  let releaseNotes: (() => void) | undefined;
  const notesPending = new Promise<void>((resolve) => { releaseNotes = resolve; });
  await page.route('**/api/interactions?**', async (route) => {
    await notesPending;
    await route.fulfill({ json: [] });
  });
  await page.goto(`/clients/${data.account.id}`);
  await expect(page.getByRole('heading', { name: data.account.full_name, exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading saved notes, tasks and documents' })).toBeVisible();
  releaseNotes?.();
  await expect(page.getByRole('status').filter({ hasText: 'Loading saved notes, tasks and documents' })).toHaveCount(0);
  expect(data.requests).not.toContain('GET /api/quote-options');
  expect(data.requests).not.toContain('GET /api/record-assets');
  expect(data.requests).not.toContain('GET /api/communication-log');
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/communication-log?**', async (route) => {
    await wait;
    await route.fulfill({ json: [] });
  });
  await page.getByRole('main').getByRole('button', { name: 'Communication', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading complete conversation' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Client conversation' }).getByRole('heading', { name: data.account.full_name, exact: true })).toBeVisible();
  await page.getByText('Message options', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Summarize Chat', exact: true })).toBeDisabled();
  await page.getByText('Message options', { exact: true }).click();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Risk review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Extract risk profile', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Loading conversation for risk insights' })).toBeVisible();
  release?.();
  await expect(page.getByRole('status').filter({ hasText: 'Loading complete conversation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Quotes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Manual quote options' })).toBeVisible();
  await expect.poll(() => data.requests).toContain('GET /api/quote-options');
});
