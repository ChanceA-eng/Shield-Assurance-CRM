import { test, expect, leadId } from './workspace-fixtures';

test('manual auto intake selects year, make and model and keeps driver and property questions', async ({ page }) => {
  await page.goto('/leads');
  await page.getByRole('button', { name: '+ New Lead', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(modal.getByRole('textbox', { name: 'Driver 1 name', exact: false })).toBeVisible();
  await modal.getByRole('combobox', { name: 'Year', exact: true }).selectOption('2024');
  await modal.getByRole('combobox', { name: 'Make', exact: true }).selectOption('HONDA');
  await modal.getByRole('combobox', { name: 'Model', exact: true }).selectOption('Civic');
  await expect(modal.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('Civic');
  await modal.getByRole('button', { name: 'Homeowners', exact: true }).click();
  await expect(modal.getByRole('textbox', { name: 'Property 1 address', exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('VIN decoding fills a reviewed vehicle and failed decoding keeps the existing details', async ({ page, data }) => {
  let failure = false;
  await page.route('**/api/vehicles?vin=**', (route) => route.fulfill(failure
    ? { status: 422, json: { message: 'The VIN could not be fully verified. Check it or enter this vehicle manually.' } }
    : { json: { details: { year: '2024', make: 'HONDA', model: 'Civic', vin: '5UXWX7C58BL123456' } } }));
  await page.goto(`/leads?lead=${leadId}&tab=assets`);
  const profile = page.getByRole('complementary', { name: 'Lead profile' });
  await profile.getByRole('button', { name: 'Assets', exact: true }).click();
  await profile.getByRole('region', { name: 'Assets & drivers' }).getByRole('button', { name: 'Add asset', exact: true }).click();
  await profile.getByRole('heading', { name: 'Add an asset', exact: true }).waitFor();
  await profile.getByRole('textbox', { name: 'VIN', exact: true }).fill('5UXWX7C58BL123456');
  await profile.getByRole('button', { name: 'Decode VIN', exact: true }).click();
  await expect(profile.getByRole('status').filter({ hasText: 'Vehicle decoded' })).toBeVisible();
  await expect(profile.getByRole('combobox', { name: 'Year', exact: true })).toHaveValue('2024');
  await expect(profile.getByRole('textbox', { name: 'Make', exact: true })).toHaveValue('HONDA');
  failure = true;
  await profile.getByRole('button', { name: 'Decode VIN', exact: true }).click();
  await expect(profile.getByRole('alert').filter({ hasText: 'could not be fully verified' })).toBeVisible();
  await expect(profile.getByRole('textbox', { name: 'Model', exact: true })).toHaveValue('Civic');
  await profile.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(profile.getByRole('heading', { name: '2024 HONDA Civic', exact: true })).toBeVisible();
  expect(data.assets.find((row) => row.title === '2024 HONDA Civic')?.metadata.details).toMatchObject({ year: '2024', make: 'HONDA', model: 'Civic' });
});

test('booking automatically confirms the saved appointment and retry cannot create a second event', async ({ page, data }) => {
  let failures = true;
  const confirms: Array<{ id: string; body: unknown }> = [];
  await page.route('**/api/events/*/confirmation', async (route) => {
    confirms.push({ id: new URL(route.request().url()).pathname.split('/')[3]!, body: route.request().postDataJSON() });
    await route.fulfill(failures ? { status: 503, json: { message: 'Gmail temporarily unavailable. Retry confirmation.' } }
      : { json: { message: 'Appointment saved and confirmation accepted by Gmail.' } });
  });
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await panel.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await expect(panel.getByRole('checkbox', { name: /Send appointment confirmation/ })).toBeChecked();
  await panel.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-15T10:30');
  await panel.getByRole('button', { name: 'Save appointment', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Appointment saved.');
  expect(data.events).toHaveLength(1);
  failures = false;
  await panel.getByRole('button', { name: 'Retry appointment confirmation', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('accepted by Gmail');
  expect(data.events).toHaveLength(1);
  expect(confirms).toHaveLength(2);
  expect(confirms[0]!.id).toBe(confirms[1]!.id);
  expect(confirms[0]!.body).toEqual({ confirmed: true, conversation: `lead:${leadId}` });
});

test('booking confirmation can be disabled before saving', async ({ page, data }) => {
  let confirms = 0;
  await page.route('**/api/events/*/confirmation', (route) => { confirms++; return route.fulfill({ json: {} }); });
  await page.goto(`/leads?lead=${leadId}&tab=conversation`);
  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await panel.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await panel.getByRole('checkbox', { name: /Send appointment confirmation/ }).uncheck();
  await panel.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-15T10:30');
  await panel.getByRole('button', { name: 'Save appointment', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Appointment saved to the calendar.');
  expect(data.events).toHaveLength(1);
  expect(confirms).toBe(0);
});
