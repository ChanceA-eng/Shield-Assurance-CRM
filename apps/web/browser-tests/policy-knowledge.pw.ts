import { test, expect } from './workspace-fixtures';

const candidate = {
  id: '0b961bce-ad74-4822-a176-7d416d93489b', revision: 1, approved_revision: null,
  account_id: 'd0b0cd9e-31fb-4a1e-99ab-cd33220adca5', created_by: '65472c9e-dbf5-4e22-ac93-6328285eff91',
  state: 'submitted', carrier: 'Example Carrier', form_number: 'CG 00 01', edition: '04 13',
  jurisdiction: 'Arizona', line_of_business: 'General liability',
  wording: 'This insurance does not apply to bodily injury expected or intended from the standpoint of the insured.',
};
test('owner explicitly reviews exact wording before approval and publication; withdrawal remains actionable', async ({ page }) => {
  let state = { ...candidate };
  const actions: string[] = [];
  await page.route('**/api/policy-knowledge', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { candidates: [state], can_review: true } }); return; }
    const body = route.request().postDataJSON() as { action: string; privacy_confirmed: boolean; rights_confirmed: boolean; revision: number };
    actions.push(body.action);
    expect(body.revision).toBe(1);
    if (body.action !== 'withdraw') {
      expect(body.privacy_confirmed).toBe(true); expect(body.rights_confirmed).toBe(true);
    }
    state = { ...state, state: body.action === 'approve' ? 'approved' : body.action === 'publish' ? 'published' : 'withdrawn' };
    await route.fulfill({ json: state });
  });
  await page.goto('/rashi/policy-review');
  const entry = page.getByRole('article');
  await expect(entry.getByRole('button', { name: 'Approve revision', exact: true })).toBeDisabled();
  await entry.getByRole('checkbox', { name: /I inspected this exact revision/ }).check();
  await entry.getByRole('checkbox', { name: /I verified permission/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await entry.getByRole('button', { name: 'Approve revision', exact: true }).click();
  await expect(entry.getByRole('button', { name: 'Publish approved wording', exact: true })).toBeDisabled();
  await entry.getByRole('checkbox', { name: /I inspected this exact revision/ }).check();
  await entry.getByRole('checkbox', { name: /I verified permission/ }).check();
  page.once('dialog', (prompt) => void prompt.accept());
  await entry.getByRole('button', { name: 'Publish approved wording', exact: true }).click();
  await expect(entry).toContainText('published');
  page.once('dialog', (prompt) => void prompt.accept());
  await entry.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(entry).toContainText('withdrawn');
  expect(actions).toEqual(['approve', 'publish', 'withdraw']);
});

test('agents can edit proposed wording but cannot approve or publish it', async ({ page }) => {
  await page.route('**/api/policy-knowledge', (route) => route.fulfill({ json: { candidates: [candidate], can_review: false } }));
  await page.goto('/rashi/policy-review');
  const entry = page.getByRole('article');
  await expect(entry.getByRole('button', { name: 'Edit and resubmit', exact: true })).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Approve revision', exact: true })).toHaveCount(0);
  await expect(entry.getByRole('button', { name: 'Publish approved wording', exact: true })).toHaveCount(0);
  await entry.getByRole('button', { name: 'Edit and resubmit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'De-identified wording', exact: true })).toHaveValue(candidate.wording);
  await expect(page.getByRole('checkbox', { name: /I removed all identifying/ })).not.toBeChecked();
});
