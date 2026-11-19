import { test, expect } from './workspace-fixtures';

interface MockClaim {
  id: string;
  policy_id: string;
  client_id: string;
  account_id: string;
  claim_number: string;
  type: string;
  status: string;
  description: string;
  date_of_loss: string;
  version: number;
  created_at: string;
  policies: { insured_name: string; carrier: string };
  events: Array<{
    id: string;
    actor_id: string;
    event_type: string;
    from_status: string | null;
    to_status: string;
    snapshot: { description: string };
    created_at: string;
  }>;
}

test('claims retain closed records and show status history', async ({ page, data }) => {
  const policy = {
    id: '74d75b6d-53a3-4f20-9c40-8dd5f0ffb3bb',
    client_id: data.account.id,
    insured_name: 'Lifecycle Fixture',
    carrier: 'Fixture Carrier',
  };
  const claim: MockClaim = {
    id: '93cc0991-93f5-45cb-9f48-008f5e8486a7',
    policy_id: policy.id,
    client_id: data.account.id,
    account_id: data.account.id,
    claim_number: 'FIXTURE-CLAIM-1',
    type: 'Auto',
    status: 'open',
    description: 'Initial loss report',
    date_of_loss: '2026-11-05',
    version: 1,
    created_at: '2026-11-05T12:00:00Z',
    policies: { insured_name: policy.insured_name, carrier: policy.carrier },
    events: [{
      id: 'claim-event-created',
      actor_id: 'fixture-agent',
      event_type: 'created',
      from_status: null,
      to_status: 'open',
      snapshot: { description: 'Initial loss report' },
      created_at: '2026-11-05T12:00:00Z',
    }],
  };
  let latestClaim: MockClaim = { ...claim };
  await page.route('**/api/policies**', async (route) => {
    await route.fulfill({ json: [policy] });
  });
  await page.route('**/api/claims**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      const filter = new URL(route.request().url()).searchParams.get('status') ?? 'open';
      await route.fulfill({
        json: filter === 'all' || latestClaim.status === filter ? [latestClaim] : [],
      });
      return;
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { version: number; status: string };
      expect(body.version).toBe(latestClaim.version);
      latestClaim = {
        ...latestClaim,
        status: body.status,
        version: latestClaim.version + 1,
        events: [...latestClaim.events, {
          id: `claim-event-${body.status}`,
          actor_id: 'fixture-agent',
          event_type: 'status_changed',
          from_status: latestClaim.status,
          to_status: body.status,
          snapshot: { description: latestClaim.description },
          created_at: '2026-11-05T13:00:00Z',
        }],
      };
      await route.fulfill({ json: latestClaim });
      return;
    }
    if (method === 'DELETE') {
      latestClaim = {
        ...latestClaim,
        status: 'closed',
        version: latestClaim.version + 1,
        events: [...latestClaim.events, {
          id: 'claim-event-closed',
          actor_id: 'fixture-agent',
          event_type: 'status_changed',
          from_status: latestClaim.status,
          to_status: 'closed',
          snapshot: { description: latestClaim.description },
          created_at: '2026-11-05T14:00:00Z',
        }],
      };
      await route.fulfill({ json: { ok: true, claim: latestClaim } });
      return;
    }
    await route.fulfill({ status: 405, json: { message: 'Method not supported.' } });
  });

  await page.goto('/claims');
  await page.getByLabel('Claim status filter').selectOption('all');
  await expect(page.getByText('Lifecycle Fixture')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox').last().selectOption('in_review');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('in_review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History (2)', exact: true }).click();
  await expect(page.getByText('open to in_review')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('closed', { exact: true })).toBeVisible();
  await expect(page.getByText('in_review to closed')).toBeVisible();
});
