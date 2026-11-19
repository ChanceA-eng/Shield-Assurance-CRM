import { test, expect } from './workspace-fixtures';

test('both account entry points share editable account intake with explicit consent and no policy creation', async ({ page, data }) => {
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/clients', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(body);
    await route.fulfill({ json: { ...data.account, ...body } });
  });
  await page.route('**/api/policies/insured-assets?**', (route) => route.fulfill({ json: [] }));
  await page.goto('/clients');
  await page.getByRole('button', { name: '+ New Account', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'New Account', exact: true });
  await account.getByLabel('Full Name', { exact: true }).fill('Reviewed account');
  await account.getByLabel('Source', { exact: true }).fill('Agent review');
  await account.getByLabel('Source', { exact: true }).press('Enter');
  await expect(account).toBeVisible();
  expect(writes).toHaveLength(0);
  await expect(account.getByRole('combobox', { name: 'Occupation', exact: true })).toBeDisabled();
  await account.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('29');
  await account.getByRole('combobox', { name: 'Occupation', exact: true }).selectOption('29-1141.00');
  await account.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('47');
  await expect(account.getByRole('combobox', { name: 'Occupation', exact: true })).toHaveValue('');
  await expect(account.getByRole('combobox', { name: 'Occupation', exact: true }).locator('option[value="29-1141.00"]')).toHaveCount(0);
  await account.getByRole('combobox', { name: 'Occupation', exact: true }).selectOption('other');
  await account.getByLabel('Other occupation', { exact: true }).fill('Specialist construction work');
  await account.getByLabel('Address', { exact: true }).fill('123 Applicant Street');
  await account.getByRole('button', { name: '+ Add driver', exact: true }).click();
  await expect(account.getByLabel('Driver 1 address', { exact: true })).toHaveValue('123 Applicant Street');
  await account.getByLabel('Driver 1 years at current address', { exact: true }).fill('2');
  await account.getByLabel('Driver 1 name', { exact: true }).fill('Reviewed account');
  await account.getByLabel('Driver 1 license number', { exact: true }).fill('QA-ACCOUNT-LICENSE');
  await account.getByRole('button', { name: '+ Add driver', exact: true }).click();
  await account.getByLabel('Driver 2 name', { exact: true }).fill('Second driver');
  await account.getByLabel('Driver 2 address', { exact: true }).fill('456 Other Driver Street');
  await account.getByLabel('Driver 2 years at current address', { exact: true }).fill('5');
  await account.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(account).toBeHidden();
  expect(writes[0]).toMatchObject({ full_name: 'Reviewed account', email_consent: false, sms_consent: false,
    intake_details: { applicant: { occupation_industry: '47', occupation: 'Specialist construction work', occupation_code: '' },
      drivers: [expect.objectContaining({ license_number: 'QA-ACCOUNT-LICENSE', years_at_address: '2', address: '123 Applicant Street' }),
        expect.objectContaining({ name: 'Second driver', address: '456 Other Driver Street', years_at_address: '5' })] } });

  await page.goto('/policies');
  await page.getByRole('button', { name: /New Policy/ }).click();
  const policy = page.getByRole('dialog', { name: 'New Policy', exact: true });
  await policy.getByRole('button', { name: 'Create a new account here', exact: true }).click();
  await policy.getByLabel('Full Name', { exact: true }).fill('Second reviewed account');
  await policy.getByLabel('Email', { exact: true }).fill('reviewed@example.invalid');
  await policy.getByLabel('Source', { exact: true }).fill('Existing customer');
  await policy.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(policy.getByLabel('Account', { exact: true })).toHaveValue(data.account.id);
  await expect(policy.getByLabel('Insured name', { exact: true })).toHaveValue('Second reviewed account');
  await expect(policy.getByPlaceholder('Policy contact email (optional)', { exact: true })).toHaveValue('reviewed@example.invalid');
  await expect(policy.getByRole('checkbox', { name: /Send this issuance confirmation/ })).not.toBeChecked();
  await expect(policy.getByRole('group', { name: 'Evidence of coverage', exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(data.requests.filter((request) => request === 'POST /api/policies')).toEqual([]);
});

test('failed account save retains fields and offers retry inside the same policy intake', async ({ page }) => {
  await page.route('**/api/clients', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    await route.fulfill({ status: 503, json: { message: 'Account save unavailable. Verify Accounts before retrying.' } });
  });
  await page.goto('/policies');
  await page.getByRole('button', { name: /New Policy/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New Policy', exact: true });
  await dialog.getByRole('button', { name: 'Create a new account here', exact: true }).click();
  await dialog.getByLabel('Full Name', { exact: true }).fill('Keep these edits');
  await dialog.getByLabel('Source', { exact: true }).fill('Manual review');
  await dialog.getByLabel('Employer', { exact: true }).fill('Keep employer');
  await dialog.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Account save unavailable. Verify Accounts before retrying.');
  await expect(dialog.getByLabel('Full Name', { exact: true })).toHaveValue('Keep these edits');
  await expect(dialog.getByLabel('Employer', { exact: true })).toHaveValue('Keep employer');
  await expect(dialog.getByRole('button', { name: 'Save Account', exact: true })).toBeEnabled();
});

test('saved account applicant details are readable after reload on mobile', async ({ page, data }) => {
  data.account.intake_details = { sections: [
    { title: 'Address history', fields: [{ label: 'Years at current address', value: '2' }] },
    { title: 'Driver 1: Synthetic driver', fields: [{ label: 'License number', value: 'QA-ACCOUNT-LICENSE' }] },
  ] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/clients/${data.account.id}`);
  const summary = page.getByRole('region', { name: 'Saved applicant information' });
  await expect(summary.getByText('QA-ACCOUNT-LICENSE', { exact: true })).toBeVisible();
  await page.reload();
  await expect(summary.getByText('Years at current address', { exact: true })).toBeVisible();
  expect(await summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
