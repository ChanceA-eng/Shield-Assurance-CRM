import { expect, test } from './workspace-fixtures';

const summary = {
  metrics: {
    mtd_written_premium: 120,
    ytd_written_premium: 120,
    active_clients: 1,
    active_policies: 1,
    open_claims: 0,
    open_endorsements: 0,
  },
  premiumTrend: [{ month: 'Nov 2026', premium: 120 }],
  carrierMix: [{ carrier: 'Fixture Carrier', count: 1, premium: 120 }],
  carrierOptions: ['Fixture Carrier'],
  claimsStatus: [],
  leadPipeline: [],
  reportCards: [],
  drilldowns: { policies: [], claims: [], endorsements: [], leads: [] },
};

test('reports paginate complete filtered drilldowns and expose a full CSV export', async ({ page }) => {
  const detailRequests: URL[] = [];
  await page.route('**/api/reports?**', (route) => route.fulfill({ json: summary }));
  await page.route('**/api/reports/production?**', (route) => {
    const url = new URL(route.request().url());
    detailRequests.push(url);
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    return route.fulfill({ json: {
      rows: [{
        id: `policy-${pageNumber}`,
        account_id: '00000000-0000-4000-8000-000000000001',
        insured_name: `Insured ${pageNumber}`,
        carrier: 'Fixture Carrier',
        premium: 120,
        effective_date: '2026-11-02',
        renewal_date: '2027-11-02',
        status: 'active',
      }],
      page: pageNumber,
      pageSize: 1,
      total: 26,
      pageCount: 26,
      filters: { start: '2026-01-01', end: '2026-11-02' },
    } });
  });

  await page.goto('/reports/production');
  await expect(page.getByRole('heading', { name: 'Production Report', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Insured 1', exact: true })).toHaveAttribute(
    'href',
    '/clients/00000000-0000-4000-8000-000000000001?context_type=policy&context_id=policy-1',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Insured 2', exact: true })).toBeVisible();
  await page.getByLabel('Carrier filter').selectOption('Fixture Carrier');
  await expect.poll(() => detailRequests.at(-1)?.searchParams.get('carrier')).toBe('Fixture Carrier');
  await expect(page.getByRole('link', { name: 'Export full CSV', exact: true })).toHaveAttribute(
    'href',
    '/api/reports/production?range=ytd&carrier=Fixture+Carrier&format=csv',
  );
});

test('owner integration status summarizes providers without exposing credentials', async ({ page, settingsOwner }) => {
  void settingsOwner;
  await page.route('**/api/settings/integrations', (route) => route.fulfill({ json: {
    integrations: [
      { id: 'database', name: 'CRM database', state: 'healthy', detail: 'Connected and responding.' },
      { id: 'resend', name: 'Email delivery (Resend)', state: 'configured', detail: 'Sending domain pending verification.' },
      { id: 'gmail', name: 'Agent Gmail', state: 'healthy', detail: '1 of 1 active mailboxes connected.', connections: [
        { email: 'agent@example.invalid', status: 'connected', last_sync_at: '2026-11-02T18:00:00Z', watch_expires_at: '2026-11-03T18:00:00Z', bootstrap_complete: true },
      ] },
      { id: 'openai', name: 'AI assistance (OpenAI)', state: 'missing', detail: 'AI features that require a provider key are unavailable.' },
    ],
  } }));

  await page.goto('/settings?tab=integrations');
  await expect(page.getByText('CRM database', { exact: true })).toBeVisible();
  await expect(page.getByText('Healthy', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sending domain pending verification.', { exact: true })).toBeVisible();
  await expect(page.getByText('agent@example.invalid', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/(?:sk-|AIza|Bearer )/);
});
