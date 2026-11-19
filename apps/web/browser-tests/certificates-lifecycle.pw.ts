import { test, expect } from './workspace-fixtures';

interface MockCertificate {
  id: string;
  policy_id: string;
  client_id: string;
  account_id: string;
  certificate_holder: string;
  holder_name: string;
  description: string;
  requested_at: string;
  requested_for: string;
  issue_date: string | null;
  document_id: string | null;
  status: string;
  version: number;
  delivery_reported_at: string | null;
  delivery_method: string | null;
  delivery_reference: string | null;
  created_at: string;
  policies: { insured_name: string; carrier: string };
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

test('certificate requests require review, an uploaded document and reported delivery evidence', async ({ page, data }) => {
  const policy = {
    id: '60cd1210-4019-4c36-b3cf-cb506ded71ae',
    client_id: data.account.id,
    insured_name: 'Certificate Fixture',
    carrier: 'Fixture Carrier',
  };
  const document = {
    id: '06ed889e-2d60-4ad2-af9e-c92293c3f6b2',
    file_name: 'fixture-certificate.pdf',
    status: 'stored',
    source_kind: 'stored',
    download_url: `/api/clients/${data.account.id}/files/06ed889e-2d60-4ad2-af9e-c92293c3f6b2/download`,
  };
  let latestCertificate: MockCertificate | null = null;
  await page.route('**/api/policies**', async (route) => route.fulfill({ json: [policy] }));
  await page.route('**/api/clients/*/files**', async (route) => route.fulfill({ json: [document] }));
  await page.route('**/api/certificates**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: latestCertificate ? [latestCertificate] : [] });
      return;
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        policy_id: policy.id,
        certificate_holder: 'Fixture certificate holder',
        requested_for: '2026-12-01',
      });
      latestCertificate = {
        id: '9420f4e3-1f12-4562-8baa-d56b3699ed7d',
        policy_id: policy.id,
        client_id: data.account.id,
        account_id: data.account.id,
        certificate_holder: String(body.certificate_holder),
        holder_name: String(body.certificate_holder),
        description: String(body.description),
        requested_at: '2026-11-05T12:00:00Z',
        requested_for: String(body.requested_for),
        issue_date: null,
        document_id: null,
        status: 'requested',
        version: 1,
        delivery_reported_at: null,
        delivery_method: null,
        delivery_reference: null,
        created_at: '2026-11-05T12:00:00Z',
        policies: { insured_name: policy.insured_name, carrier: policy.carrier },
        events: [{
          id: 'certificate-event-created',
          actor_id: 'fixture-agent',
          event_type: 'created',
          from_status: null,
          to_status: 'requested',
          snapshot: { description: String(body.description) },
          created_at: '2026-11-05T12:00:00Z',
        }],
      };
      await route.fulfill({ status: 201, json: latestCertificate });
      return;
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.version).toBe(latestCertificate?.version);
      if (body.status === 'issued') {
        expect(body.document_id).toBe(document.id);
        expect(body.issue_date).toBe('2026-11-05');
      }
      if (body.status === 'delivery_reported') {
        expect(body.delivery_method).toBe('email');
        expect(body.delivery_reference).toBe('FIXTURE-DELIVERY-1');
      }
      const nextStatus = String(body.status);
      const previousStatus = latestCertificate!.status;
      latestCertificate = {
        ...latestCertificate!,
        status: nextStatus,
        version: latestCertificate!.version + 1,
        document_id: typeof body.document_id === 'string' ? body.document_id : latestCertificate!.document_id,
        issue_date: typeof body.issue_date === 'string' ? body.issue_date : latestCertificate!.issue_date,
        delivery_method: typeof body.delivery_method === 'string' ? body.delivery_method : latestCertificate!.delivery_method,
        delivery_reference: typeof body.delivery_reference === 'string' ? body.delivery_reference : latestCertificate!.delivery_reference,
        delivery_reported_at: nextStatus === 'delivery_reported' ? '2026-11-05T14:00:00Z' : latestCertificate!.delivery_reported_at,
        events: [...latestCertificate!.events, {
          id: `certificate-event-${nextStatus}`,
          actor_id: 'fixture-agent',
          event_type: 'status_changed',
          from_status: previousStatus,
          to_status: nextStatus,
          snapshot: {
            description: latestCertificate!.description,
            delivery_reference: body.delivery_reference,
          },
          created_at: '2026-11-05T13:00:00Z',
        }],
      };
      await route.fulfill({ json: latestCertificate });
      return;
    }
    await route.fulfill({ status: 405, json: { message: 'Method not supported.' } });
  });

  await page.goto('/certificates');
  await page.getByRole('button', { name: '+ Request Certificate', exact: true }).click();
  await page.getByRole('combobox').first().selectOption(policy.id);
  await page.getByPlaceholder('Certificate Holder').fill('Fixture certificate holder');
  await page.getByPlaceholder('Description').fill('Provide current evidence of coverage.');
  await page.getByLabel('Date needed (optional)').fill('2026-12-01');
  await page.getByRole('button', { name: 'Create Request', exact: true }).click();
  await expect(page.getByText('Requested', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Certificate status').selectOption('in_review');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('In review', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Certificate status').selectOption('issued');
  await page.getByLabel('Actual issue date').fill('2026-11-05');
  await page.getByLabel('Uploaded certificate document').selectOption(document.id);
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Issued', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Certificate status').selectOption('delivery_reported');
  await page.getByLabel('Delivery method').selectOption('email');
  await page.getByLabel('Delivery reference (optional)').fill('FIXTURE-DELIVERY-1');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Delivery reported', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History (4)', exact: true }).click();
  await expect(page.getByText('Reference FIXTURE-DELIVERY-1')).toBeVisible();
});
