import { test, expect, leadId } from './workspace-fixtures';

test('lead profile separates predicted months from reported dates and shows source provenance', async ({ page, data }) => {
  Object.assign(data.lead.form_payload, {
    profile: {
      kind: 'commercial', company: { industry: 'Synthetic test business' },
      renewals: [
        { type: 'General Liability', date: '2027-04-22', evidence_class: 'predicted', precision: 'month' },
        { type: 'Workers Comp', date: '2027-05-10', evidence_class: 'vendor_reported', precision: 'date' },
      ],
      invalid_renewal_fields: ['Benefits Renewal'],
      enrichment: { fmcsa: {
        dot_number: '123', legal_name: 'Synthetic source business', match_method: 'name_search',
        power_units: 12, drivers: 3, operating_status: 'Active', safety_rating: null,
        driver_oos_rate: null, vehicle_oos_rate: null, crashes_total: null,
        fetched_at: '2026-11-05T09:00:00Z',
      } },
    },
    import: { file_name: 'Synthetic source.csv', observed_at: '2026-11-05T09:00:00Z' },
  });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Predicted month: 2027-04', { exact: true })).toBeVisible();
  await expect(page.getByText('Vendor-reported date: 2027-05-10', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic source.csv', { exact: true })).toBeVisible();
  await expect(page.getByText(/Review invalid source dates: Benefits Renewal/)).toBeVisible();
  await expect(page.getByText('Name match not confirmed; verify business identity', { exact: true })).toBeVisible();
  await expect(page.getByText('2027-04-22', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Predicted month: 2027-04', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
