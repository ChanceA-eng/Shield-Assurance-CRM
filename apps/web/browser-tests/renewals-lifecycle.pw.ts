import { test, expect } from './workspace-fixtures';

interface MockRenewalReview {
  id: string;
  policy_id: string;
  account_id: string;
  renewal_term: string;
  status: string;
  assigned_to: string;
  assigned_email: string;
  notes: string;
  follow_up_date: string | null;
  next_policy_id: string | null;
  version: number;
  events: Array<{
    id: string;
    actor_id: string;
    event_type: string;
    from_status: string | null;
    to_status: string;
    snapshot: Record<string, unknown>;
    created_at: string;
  }>;
}

test('renewal reviews retain owner, outcome, linked next term and history', async ({ page, data }) => {
  const policy = {
    id: '2583bd4d-8a22-48da-8a26-10d38da0e6f4',
    client_id: data.account.id,
    account_id: data.account.id,
    insured_name: 'Renewal Fixture',
    carrier: 'Fixture Carrier',
    line_of_business: 'Commercial',
    premium: 1250,
    renewal_date: '2027-01-01',
    renewal_on: '2027-01-01',
    expiration_date: '2027-01-01',
    status: 'active',
    review: null as MockRenewalReview | null,
  };
  const ownerId = 'c56a96d2-7984-4d19-9520-b3ffdfce651e';
  const nextPolicy = {
    id: '8da289c8-8ccf-4120-b62f-269ed50cfcd0',
    prior_policy_id: policy.id,
    policy_number: 'FIXTURE-NEXT-TERM',
    insured_name: policy.insured_name,
  };
  const counts = { '30': 1, '60': 0, '90': 0, overdue: 0 };

  await page.route('**/api/policies**', async (route) => {
    await route.fulfill({ json: [nextPolicy] });
  });
  await page.route('**/api/agency/assignment**', async (route) => {
    await route.fulfill({ json: { members: [{ user_id: ownerId, email: 'renewal-owner@example.invalid', active: true }] } });
  });
  await page.route('**/api/renewals**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/renewals/reviews') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (route.request().method() === 'POST') {
        expect(body).toMatchObject({
          policy_id: policy.id,
          renewal_term: policy.renewal_on,
          assigned_to: ownerId,
        });
        policy.review = {
          id: '9a1956ea-73c8-440b-90cc-792087676c42',
          policy_id: policy.id,
          account_id: data.account.id,
          renewal_term: policy.renewal_on,
          status: 'in_review',
          assigned_to: ownerId,
          assigned_email: 'renewal-owner@example.invalid',
          notes: String(body.notes),
          follow_up_date: typeof body.follow_up_date === 'string' ? body.follow_up_date : null,
          next_policy_id: null,
          version: 1,
          events: [{
            id: 'renewal-review-created',
            actor_id: 'fixture-agent',
            event_type: 'created',
            from_status: null,
            to_status: 'in_review',
            snapshot: { notes: String(body.notes) },
            created_at: '2026-11-05T12:00:00Z',
          }],
        };
        await route.fulfill({ status: 201, json: policy.review });
        return;
      }

      expect(body.id).toBe(policy.review?.id);
      expect(body.version).toBe(policy.review?.version);
      const previousStatus = policy.review!.status;
      const nextStatus = String(body.status);
      policy.review = {
        ...policy.review!,
        status: nextStatus,
        assigned_to: String(body.assigned_to),
        notes: String(body.notes),
        follow_up_date: typeof body.follow_up_date === 'string' ? body.follow_up_date : null,
        next_policy_id: typeof body.next_policy_id === 'string' ? body.next_policy_id : null,
        version: policy.review!.version + 1,
        events: [...policy.review!.events, {
          id: `renewal-review-${nextStatus}`,
          actor_id: 'fixture-agent',
          event_type: 'status_changed',
          from_status: previousStatus,
          to_status: nextStatus,
          snapshot: { notes: String(body.notes) },
          created_at: '2026-11-05T13:00:00Z',
        }],
      };
      if (nextStatus === 'renewed') expect(body.next_policy_id).toBe(nextPolicy.id);
      await route.fulfill({ json: policy.review });
      return;
    }

    await route.fulfill({
      json: {
        window: '30',
        counts,
        items: [{
          ...policy,
          review: policy.review,
        }],
      },
    });
  });

  await page.goto('/renewals');
  await expect(page.getByText('Renewal Fixture')).toBeVisible();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByLabel('Owner').selectOption(ownerId);
  await page.getByLabel('Review notes').fill('Compare current terms before renewal.');
  await page.getByLabel('Follow-up date (optional)').fill('2026-12-01');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('In review', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Update review', exact: true }).click();
  await page.getByLabel('Outcome').selectOption('remarketing');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Remarketing', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Update review', exact: true }).click();
  await page.getByLabel('Outcome').selectOption('renewed');
  await page.getByLabel('Linked issued next term').selectOption(nextPolicy.id);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Renewed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History (3)', exact: true }).click();
  await expect(page.getByText('In review to Remarketing')).toBeVisible();
  await expect(page.getByText('Remarketing to Renewed')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Compare current terms before renewal.' })).toHaveCount(3);
});
