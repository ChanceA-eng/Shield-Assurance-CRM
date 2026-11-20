import { test, expect } from './workspace-fixtures';
import { SALES_TEMPLATES, type SalesTemplate } from '@crm/shared';

test('Rashi answers CRM tool questions through the real chat endpoint', async ({ page, settingsOwner }) => {
  void settingsOwner;
  await page.route('**/api/rashi/chat', (route) => route.continue());
  await page.goto('/settings?tab=email');
  await page.getByRole('button', { name: 'Rashi', exact: true }).click();
  await page.getByPlaceholder('Ask about CRM tools or underwriting...').fill('How do I set up agency email replies?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(/An unconfirmed send must not be sent again/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Email settings', exact: true })).toHaveAttribute('href', '/settings?tab=email');
});

test('template merge fields insert usable text and remain available after save', async ({ page, settingsOwner }) => {
  void settingsOwner;
  let saved: SalesTemplate = structuredClone(SALES_TEMPLATES[0]);
  await page.route('**/api/sales-templates', async (route) => {
    if (route.request().method() === 'PATCH') {
      const submitted: SalesTemplate = route.request().postDataJSON();
      expect(submitted.email_body).toBe(`${saved.email_body}{{contact_name}}`);
      saved = { ...submitted, revision: saved.revision + 1 };
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: { templates: [saved], canManage: true } });
  });
  await page.goto('/settings?tab=automation&section=templates');
  const chooser = page.getByLabel('Saved CRM templates', { exact: true });
  await expect(chooser.locator('option')).not.toHaveCount(1);
  await chooser.selectOption({ index: 1 });
  const body = page.getByRole('textbox', { name: 'Email body', exact: true });
  const before = await body.inputValue();
  await page.getByLabel('Insert merge field').selectOption('contact_name');
  await expect(body).toHaveValue(`${before}{{contact_name}}`);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved in CRM' })).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved templates', exact: true }).click();
  await chooser.selectOption({ index: 1 });
  await expect(body).toHaveValue(`${before}{{contact_name}}`);
});
