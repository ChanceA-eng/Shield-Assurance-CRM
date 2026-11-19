import { test, expect } from './workspace-fixtures';

test('policy servicing requests retain confirmation evidence and linked follow-up status', async ({ page, data }) => {
  interface MockRequest {
    id: string;
    policy_id: string;
    requested_at: string;
    description: string;
    status: string;
    request_type: string;
    requested_effective_date: string | null;
    carrier_submitted_at: string | null;
    carrier_confirmed_on: string | null;
    confirmation_reference: string | null;
    assigned_to: string | null;
    assigned_email: string | null;
    requested_by: string;
    created_at: string;
    updated_at: string;
    version: number;
    policies: { carrier: string; policy_number: string; line_of_business: string };
    events: Array<{
      id: string;
      event_type: string;
      from_status: string | null;
      to_status: string;
      snapshot: { description: string };
      created_at: string;
    }>;
    task: { id: string; status: string };
  }
  const ownerId = 'c56a96d2-7984-4d19-9520-b3ffdfce651e';
  const fileId = 'd90f58a5-3121-4d21-9dc0-b5a76f8a6304';
  const availableFile = {
    id: fileId, client_id: data.account.id, file_name: 'fixture-service-document.pdf', file_type: 'PDF',
    file_size: 128, status: 'stored', source_kind: 'stored', file_url: null, download_url: `/api/clients/${data.account.id}/files/${fileId}/download`,
    content_type: 'application/pdf', uploaded_by: 'fixture-agent', uploaded_at: '2026-11-05T12:00:00Z', notes: null,
  };

  const policy = {
    id: 'f363c2c7-bac2-4c52-86d5-b99937f5a733',
    client_id: data.account.id,
    carrier: 'Fixture Carrier',
    policy_number: 'FIXTURE-100',
    line_of_business: 'Commercial',
    status: 'active',
    effective_date: '2026-01-01',
    renewal_date: '2027-01-01',
    expiration_date: '2027-01-01',
  };
  data.policies = [policy];
  const request: MockRequest = {
    id: 'bb203436-8ee8-48a5-b196-15da3b4e1b31',
    policy_id: policy.id,
    requested_at: '2026-11-05T12:00:00Z',
    description: 'Add the new vehicle after reviewing its details.',
    status: 'draft',
    request_type: 'vehicle_addition',
    requested_effective_date: '2026-12-01',
    carrier_submitted_at: null,
    carrier_confirmed_on: null,
    confirmation_reference: null,
    assigned_to: null,
    assigned_email: null,
    requested_by: 'fixture-agent',
    created_at: '2026-11-05T12:00:00Z',
    updated_at: '2026-11-05T12:00:00Z',
    version: 1,
    policies: { carrier: 'Fixture Carrier', policy_number: 'FIXTURE-100', line_of_business: 'Commercial' },
    events: [{
      id: 'event-created',
      event_type: 'created',
      from_status: null,
      to_status: 'draft',
      snapshot: { description: 'Add the new vehicle after reviewing its details.' },
      created_at: '2026-11-05T12:00:00Z',
    }],
    task: { id: 'fixture-task', status: 'open' },
  };
  let latestRequest: MockRequest | null = null;
  const documents: Array<Record<string, unknown>> = [];
  await page.route('**/api/agency/assignment**', async (route) => {
    await route.fulfill({ json: { members: [{ user_id: ownerId, email: 'service-owner@example.invalid', active: true }] } });
  });
  await page.route('**/api/clients/*/files**', async (route) => {
    await route.fulfill({ json: [availableFile] });
  });
  await page.route('**/api/policy-change-requests**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/documents')) {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: documents });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ account_id: data.account.id, request_id: latestRequest?.id, file_id: fileId });
      documents.push({
        id: 'fixture-service-document-link', request_id: latestRequest?.id, file_id: fileId,
        file_snapshot: { file_name: availableFile.file_name, source_kind: 'stored' },
        added_by: 'fixture-agent', added_at: '2026-11-05T12:30:00Z',
        download_url: availableFile.download_url,
      });
      await route.fulfill({ status: 201, json: documents[0] });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: latestRequest ? [latestRequest] : [] });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        account_id: data.account.id,
        policy_id: policy.id,
        request_type: 'vehicle_addition',
        requested_effective_date: '2026-12-01',
        assigned_to: ownerId,
      });
      latestRequest = { ...request, description: String(body.description), assigned_to: ownerId, assigned_email: 'service-owner@example.invalid' };
      await route.fulfill({ status: 201, json: latestRequest });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.version).toBe(latestRequest?.version);
      const nextStatus = typeof body.status === 'string' ? body.status : latestRequest!.status;
      const previousStatus = latestRequest!.status;
      latestRequest = {
        ...latestRequest!,
        status: nextStatus,
        assigned_to: typeof body.assigned_to === 'string' ? body.assigned_to : latestRequest!.assigned_to,
        assigned_email: typeof body.assigned_to === 'string' ? 'service-owner@example.invalid' : latestRequest!.assigned_email,
        carrier_confirmed_on: typeof body.carrier_confirmed_on === 'string' ? body.carrier_confirmed_on : null,
        confirmation_reference: typeof body.confirmation_reference === 'string' ? body.confirmation_reference : null,
        version: latestRequest!.version + 1,
        events: [...latestRequest!.events, {
          id: `event-${nextStatus}`, event_type: 'status_changed', from_status: previousStatus, to_status: nextStatus,
          snapshot: { description: latestRequest!.description }, created_at: '2026-11-05T13:00:00Z',
        }],
        task: { id: 'fixture-task', status: nextStatus === 'confirmed' ? 'completed' : 'open' },
      };
      await route.fulfill({ json: latestRequest });
      return;
    }
    await route.fulfill({ status: 405, json: { message: 'Method not supported.' } });
  });

  await page.goto(`/clients/${data.account.id}`);
  await page.getByLabel('Account sections').getByRole('button', { name: 'Policies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy servicing', exact: true })).toBeVisible();
  await page.getByRole('combobox').nth(0).selectOption(policy.id);
  await page.getByLabel('Request type').selectOption('vehicle_addition');
  await page.getByLabel('Requested effective date (optional)').fill('2026-12-01');
  await page.getByLabel('New service request owner').selectOption(ownerId);
  await page.getByLabel('What needs to change?').fill(request.description);
  await page.getByRole('button', { name: 'Create servicing request', exact: true }).click();
  await expect(page.getByText('Follow-up task: Open', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Owner for FIXTURE-100')).toHaveValue(ownerId);
  await page.getByLabel('Service request document', { exact: true }).selectOption(fileId);
  await page.getByRole('button', { name: 'Link document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'fixture-service-document.pdf', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move to Submitted', exact: true }).click();
  await expect(page.getByLabel('Carrier confirmation date')).toBeVisible();
  await page.getByLabel('Carrier confirmation date').fill('2026-11-05');
  await page.getByLabel('Carrier reference').fill('FIXTURE-CONFIRM-1');
  await page.getByRole('button', { name: 'Move to Carrier confirmed', exact: true }).click();
  await expect(page.getByText('Carrier confirmation reported 2026-11-05: FIXTURE-CONFIRM-1')).toBeVisible();
  await expect(page.getByText('Follow-up task: Completed', { exact: true })).toBeVisible();
  await page.getByText('History (3)', { exact: true }).click();
  await expect(page.getByText('Submitted → Carrier confirmed', { exact: true })).toBeVisible();
});
