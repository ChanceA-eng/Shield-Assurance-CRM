import { test, expect, leadId } from './workspace-fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/policy-change-requests?**', (route) => route.fulfill({ json: [] }));
});

test('linked lead policy handoff prefills identity and retains the issuance ID after a failed save', async ({ page, data }) => {
  data.linked = true;
  data.lead.account_id = data.account.id;
  const saved: Array<Record<string, unknown>> = [];
  const prefillRequests: string[] = [];
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/prefill?**', (route) => {
    prefillRequests.push(route.request().url());
    return route.fulfill({ json: {
    account_id: data.account.id, account_name: data.account.full_name, lead_id: leadId,
    insured_name: data.lead.full_name, phone: data.lead.phone, email: data.lead.email,
    address: data.lead.address, line_of_business: data.lead.line_of_business,
    } });
  });
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [data.lead] }));
  await page.route('**/api/policies', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    saved.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill(saved.length === 1
      ? { status: 503, json: { message: 'Policy save could not be confirmed. Retry.' } }
      : { status: 201, json: { id: leadId, warnings: [] } });
  });
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Record policy', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/policies\\?account_id=${data.account.id}&lead_id=${leadId}`));
  await expect.poll(() => prefillRequests.length).toBeGreaterThanOrEqual(1);
  expect(prefillRequests.every((url) => new URL(url).searchParams.get('account_id') === data.account.id
    && new URL(url).searchParams.get('lead_id') === leadId)).toBe(true);
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue(data.account.id);
  await expect(page.getByLabel('Lead to complete', { exact: true })).toHaveValue(leadId);
  await expect(page.getByLabel('Insured name', { exact: true })).toHaveValue(data.lead.full_name);
  await expect(page.getByPlaceholder('Policy contact email (optional)', { exact: true })).toHaveValue(data.lead.email);
  await expect(page.getByPlaceholder('Premium', { exact: true })).toHaveValue('');
  await page.getByPlaceholder('Carrier', { exact: true }).fill('Confirmed test carrier');
  await page.getByPlaceholder('Premium', { exact: true }).fill('1250');
  await page.getByPlaceholder('Policy Number', { exact: true }).fill('CONFIRMED-1');
  await page.getByLabel('Effective date', { exact: true }).fill('2026-11-02');
  await page.getByLabel('Expiration date', { exact: true }).fill('2027-11-02');
  await page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  expect(saved).toHaveLength(0);
  await page.getByRole('checkbox', { name: /Carrier binding or issuance confirmed/ }).check();
  await page.getByLabel('Evidence date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Carrier evidence reference', { exact: true }).fill('Carrier portal ABC');
  await page.getByRole('checkbox', { name: /I reviewed this evidence/ }).check();
  await page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Policy save could not be confirmed' }).last()).toBeVisible();
  await expect(page.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('CONFIRMED-1');
  await page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toHaveCount(0);
  expect(saved).toHaveLength(2);
  expect(saved[0].request_id).toBe(saved[1].request_id);
  expect(saved[1]).toMatchObject({ account_id: data.account.id, lead_id: leadId, carrier_confirmed: true, email_consent: false });
});

test('account policy handoff selects no lead and shows prefill errors without issuing coverage', async ({ page, data }) => {
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/prefill?**', (route) => route.fulfill({ json: {
    account_id: data.account.id, account_name: data.account.full_name, lead_id: null,
    insured_name: data.account.full_name, phone: data.account.phone, email: '',
    address: data.account.address, line_of_business: '',
  } }));
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [] }));
  await page.goto(`/clients/${data.account.id}`);
  await page.getByRole('button', { name: 'Record policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  await expect(page.getByLabel('Lead to complete', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Insured name', { exact: true })).toHaveValue(data.account.full_name);
  await page.route('**/api/policies/prefill?**', (route) => route.fulfill({ status: 409, json: { message: 'Lead belongs to another account.' } }));
  await page.goto(`/policies?account_id=${data.account.id}&lead_id=${leadId}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Lead belongs to another account.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toHaveCount(0);
});

test('selected accepted quote prefills quoted terms, keeps confirmation off and submits exact quote provenance', async ({ page, data }) => {
  const quoteId = '108a5200-9382-4c96-a6e8-a3c09d6f0e40';
  const version = '2026-11-02T21:00:00Z';
  const submissions: Array<Record<string, unknown>> = [];
  const prefillRequests: string[] = [];
  const assetId = 'c3db2f75-a682-4d14-8c76-693b4f123456';
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [{
    id: assetId, title: 'Truck 1', asset_type: 'vehicle', value: '$25,000',
    metadata: { details: { year: '2025', vin: 'QA-123' } },
  }] }));
  await page.route('**/api/quote-options?**', (route) => route.fulfill({ json: [{
    id: quoteId, client_id: data.account.id, lead_id: null, carrier: 'Quote Carrier', line_of_business: 'Commercial Auto',
    premium: 1700.55, effective_date: '2026-11-02', expiration_date: '2027-11-02', status: 'accepted',
    limits: '$1m', deductibles: '$500', notes: '', created_at: version, updated_at: version, updated_by: 'QA',
  }] }));
  await page.route('**/api/policies/prefill?**', (route) => {
    prefillRequests.push(route.request().url());
    return route.fulfill({ json: {
    account_id: data.account.id, account_name: data.account.full_name, lead_id: null,
    insured_name: data.account.full_name, phone: data.account.phone, email: '', address: data.account.address,
    quote_id: quoteId, quote_version: version, carrier: 'Quote Carrier', line_of_business: 'Commercial Auto',
    premium: 1700.55, effective_date: '2026-11-02', expiration_date: '2027-11-02', limits: '$1m', deductibles: '$500',
  } });
  });
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: { id: quoteId, quote_option_id: quoteId, warnings: [] } });
  });

  await page.goto(`/clients/${data.account.id}`);
  await page.getByRole('button', { name: 'Quotes', exact: true }).click();
  await page.getByRole('button', { name: 'Record policy from Quote Carrier', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/policies\\?account_id=${data.account.id}&quote_id=${quoteId}`));
  await expect.poll(() => prefillRequests.length).toBe(1);
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Carrier', { exact: true })).toHaveValue('Quote Carrier');
  await expect(page.getByPlaceholder('Premium', { exact: true })).toHaveValue('1700.55');
  await expect(page.getByLabel('Line of business', { exact: true })).toHaveValue('Commercial Auto');
  await expect(page.getByLabel('Expiration date', { exact: true })).toHaveValue('2027-11-02');
  await expect(page.getByText('Quoted limits: $1m', { exact: true })).toBeVisible();
  await expect(page.getByText(/Truck 1 · vehicle · \$25,000/)).toBeVisible();
  await page.getByLabel(/Truck 1/).check();
  await expect(page.getByRole('checkbox', { name: /Carrier binding or issuance confirmed/ })).not.toBeChecked();
  await page.getByPlaceholder('Policy Number', { exact: true }).fill('CARRIER-CONFIRMED');
  await page.getByRole('checkbox', { name: /Carrier binding or issuance confirmed/ }).check();
  await page.getByLabel('Evidence date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Carrier evidence reference', { exact: true }).fill('Carrier portal ABC');
  await page.getByRole('checkbox', { name: /I reviewed this evidence/ }).check();
  await page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toHaveCount(0);
  expect(submissions[0]).toMatchObject({ quote_id: quoteId, quote_version: version, account_id: data.account.id,
    lead_id: null, carrier_confirmed: true, line_of_business: 'Commercial Auto', insured_asset_ids: [assetId] });
  data.policies.push({ id: quoteId, client_id: data.account.id, carrier: 'Confirmed carrier', line_of_business: 'Commercial Auto',
    premium: 1700.55, policy_number: 'CARRIER-CONFIRMED', status: 'issued', effective_date: '2026-11-02',
    renewal_date: '2027-11-02', quote_snapshot: { carrier: 'Original quoted carrier', limits: '$1m', deductibles: '$500' } });
  await page.goto(`/clients/${data.account.id}?tab=policies`);
  await page.getByText('Original quote at placement', { exact: true }).click();
  await expect(page.getByText('Original quoted carrier', { exact: true })).toBeVisible();
  await expect(page.getByText('$1m', { exact: true })).toBeVisible();
});

test('policy term starts a safe renewal with verified account context and blank new-term dates', async ({ page, data }) => {
  const policyId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
  const posted: Array<Record<string, unknown>> = [];
  await page.route('**/api/clients/*/context?*', (route) => route.fulfill({ json: { type: 'policy', record: {
    id: policyId, client_id: data.account.id, insured_name: 'Prior insured', carrier: 'Prior carrier',
    line_of_business: 'Commercial Auto', premium: 2300, policy_number: 'OLD-1',
    effective_date: '2025-01-01', expiration_date: '2026-01-01', status: 'expired',
    insured_asset_schedule: [{ id: 'a7fe12d8-a8bc-4f0c-aeab-3c800d246124', asset_id: 'c3db2f75-a682-4d14-8c76-693b4f123456',
      snapshot: { title: 'Prior insured truck', asset_type: 'vehicle', metadata: { details: { year: '2025', vin: 'QA-123' } } } }],
  } } }));
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/prefill?**', (route) => route.fulfill({ json: {
    account_id: data.account.id, account_name: data.account.full_name, lead_id: null,
    insured_name: 'Prior insured', phone: '', email: '', address: '', line_of_business: 'Commercial Auto',
    prior_policy_id: policyId, prior_policy_number: 'OLD-1', prior_expiration_date: '2026-01-01',
    carrier: 'Prior carrier', premium: 2300,
  } }));
  await page.route('**/api/policies', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: { id: policyId, warnings: [] } });
  });
  await page.goto(`/clients/${data.account.id}?context_type=policy&context_id=${policyId}`);
  await expect(page.getByText('Prior insured truck')).toBeVisible();
  await page.getByRole('link', { name: 'Start renewal from this term', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  await expect(page.getByText('Renewal from OLD-1.', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Carrier', { exact: true })).toHaveValue('Prior carrier');
  await expect(page.getByLabel('Line of business', { exact: true })).toHaveValue('Commercial Auto');
  await expect(page.getByPlaceholder('Policy Number', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Effective date', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Expiration date', { exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: /Carrier binding or issuance confirmed/ })).not.toBeChecked();
  await expect(page.getByText('No active account assets available. You can record the policy without a schedule.')).toBeVisible();
  await page.getByPlaceholder('Policy Number', { exact: true }).fill('NEW-1');
  await page.getByLabel('Effective date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Expiration date', { exact: true }).fill('2027-01-01');
  await page.getByRole('checkbox', { name: /Carrier binding or issuance confirmed/ }).check();
  await page.getByLabel('Evidence date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Carrier evidence reference', { exact: true }).fill('Carrier portal ABC');
  await page.getByRole('checkbox', { name: /I reviewed this evidence/ }).check();
  await page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  expect(posted[0]).toMatchObject({ account_id: data.account.id, lead_id: null, prior_policy_id: policyId,
    carrier: 'Prior carrier', source: 'Renewal', policy_number: 'NEW-1', carrier_confirmed: true });
  expect(posted[0].request_id).toBeTruthy();
});

test('rewrite workspace selects an exact prior term without cancellation or carried-forward confirmation', async ({ page, data }) => {
  const policyId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
  await page.route('**/api/policies?**', (route) => route.fulfill({ json: [{
    id: policyId, client_id: data.account.id, insured_name: 'Rewrite insured', policy_number: 'ORIGINAL-TERM',
    carrier: 'Original carrier', status: 'issued', source: 'Policy Issuance', premium: 1500,
    line_of_business: 'Auto', effective_date: '2026-01-01', renewal_date: '2027-01-01',
  }] }));
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/policies/identity?**', (route) => route.fulfill({ json: [] }));
  let prefill = '';
  await page.route('**/api/policies/prefill?**', (route) => {
    prefill = route.request().url();
    return route.fulfill({ json: { account_id: data.account.id, account_name: data.account.full_name, lead_id: null,
      insured_name: 'Rewrite insured', carrier: 'Original carrier', premium: 1500, line_of_business: 'Auto',
      phone: '', email: '', address: '', prior_policy_id: policyId, prior_policy_number: 'ORIGINAL-TERM', source: 'Rewrite' } });
  });
  await page.goto('/policies/rewrites');
  await expect(page.getByText('Rewrite insured · ORIGINAL-TERM', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Start rewrite', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Policy', exact: true })).toBeVisible();
  expect(prefill).toContain(`rewrite_from_id=${policyId}`);
  await expect(page.getByText('Rewrite from ORIGINAL-TERM.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Effective date', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Evidence date', { exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: /I reviewed this evidence/ })).not.toBeChecked();
  await expect(page.getByLabel('Lead to complete', { exact: true })).toBeDisabled();
});

test('policy history and documents load on demand and retry attachment with the same file', async ({ page, data }) => {
  const policyId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
  const fileId = 'c3db2f75-a682-4d14-8c76-693b4f123456';
  await page.route('**/api/clients/*/context?*', (route) => route.fulfill({ json: { type: 'policy', record: {
    id: policyId, client_id: data.account.id, insured_name: 'Document insured', policy_number: 'TERM-1',
    confirmation_evidence: { confirmation: { confirmed_on: '2026-01-01', reference: 'PORTAL-123', attested: true },
      recorded_by: 'QA operator', recorded_at: '2026-01-01T12:00:00Z' },
  } } }));
  await page.route('**/api/clients/*/files?**', (route) => route.fulfill({ json: [{
    id: fileId, client_id: data.account.id, file_name: 'Carrier-evidence.pdf', source_kind: 'stored', status: 'stored',
  }] }));
  let reads = 0, attachments = 0;
  await page.route('**/api/policies/history?**', (route) => {
    reads++;
    return route.fulfill({ json: [{ id: '9007199254740993', event: 'recorded', snapshot: { policy_number: 'TERM-1' },
      recorded_by: 'QA history operator', recorded_at: '2026-01-01T12:00:00Z' }] });
  });
  await page.route('**/api/placement-documents?**', (route) => {
    if (route.request().method() === 'POST') {
      attachments++;
      expect(route.request().postDataJSON()).toEqual({ file_id: fileId });
      return route.fulfill(attachments === 1 ? { status: 503, json: { message: 'Attachment temporarily unavailable.' } } : { status: 201, json: { id: fileId } });
    }
    return route.fulfill({ json: attachments > 1 ? [{
      id: fileId, file_id: fileId, file_snapshot: { file_name: 'Carrier-evidence.pdf' }, added_by: 'QA operator', added_at: '2026-01-01T12:00:00Z',
    }] : [] });
  });
  await page.goto(`/clients/${data.account.id}?context_type=policy&context_id=${policyId}`);
  await expect(page.getByText('Carrier reference: PORTAL-123')).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'View policy record history', exact: true }).click();
  await expect(page.getByText(/QA history operator/)).toBeVisible();
  expect(reads).toBe(1);
  await page.getByRole('button', { name: 'View policy documents', exact: true }).click();
  await page.getByLabel('Uploaded account document', { exact: true }).selectOption(fileId);
  await page.getByRole('button', { name: 'Link document to policy', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Attachment temporarily unavailable.' })).toBeVisible();
  await expect(page.getByLabel('Uploaded account document', { exact: true })).toHaveValue(fileId);
  await page.getByRole('button', { name: 'Link document to policy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Carrier-evidence.pdf', exact: true })).toBeVisible();
  expect(attachments).toBe(2);
});
