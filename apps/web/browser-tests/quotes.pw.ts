import { test, expect, leadId } from './workspace-fixtures';
import type { QuoteHistoryEntry } from '../src/lib/quote-options';

test('manual quotes save multiple options, retain failed drafts across tabs and do not establish coverage', async ({ page, data }) => {
  const quotes: Array<Record<string, unknown>> = [];
  const saves: Array<Record<string, unknown>> = [];
  let fail = true;
  await page.route('**/api/quote-options?**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: quotes }); return; }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saves.push(body);
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { message: 'Quote save failed. Retry this draft.' } }); return; }
    const row = { ...body, premium: Number(body.premium), client_id: data.account.id, lead_id: leadId, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: 'QA' };
    quotes.push(row);
    await route.fulfill({ status: 201, json: row });
  });

  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Quotes', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Manual quote options' });
  await panel.getByRole('button', { name: 'Add quote option' }).click();
  await panel.getByLabel('Carrier', { exact: true }).fill('Carrier One');
  await panel.getByLabel('Line of business', { exact: true }).fill('Commercial Auto');
  await panel.getByLabel('Premium', { exact: true }).fill('1500.55');
  await panel.getByLabel('Quote status').selectOption('accepted');
  await panel.getByRole('button', { name: 'Save quote option' }).click();
  await expect(panel.getByRole('alert')).toContainText('Quote save failed');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Quotes', exact: true }).click();
  await expect(panel.getByLabel('Carrier', { exact: true })).toHaveValue('Carrier One');
  await panel.getByRole('button', { name: 'Save quote option' }).click();
  await expect(panel.getByRole('heading', { name: 'Carrier One · Commercial Auto' })).toBeVisible();
  expect(saves[0].id).toBe(saves[1].id);
  await panel.getByRole('button', { name: 'Add quote option' }).click();
  await panel.getByLabel('Carrier', { exact: true }).fill('Carrier Two');
  await panel.getByLabel('Line of business', { exact: true }).fill('Commercial Auto');
  await panel.getByLabel('Premium', { exact: true }).fill('1650');
  await panel.getByRole('button', { name: 'Save quote option' }).click();
  await expect(panel.getByRole('heading', { name: 'Carrier Two · Commercial Auto' })).toBeVisible();
  expect(quotes).toHaveLength(2);
  expect(data.lead.status).toBe('new');
  expect(data.policies).toHaveLength(0);
});

for (const workspace of ['account', 'lead'] as const) {
    test(`${workspace} quote history loads on demand, preserves revisions and retries older pages without losing an edit draft`, async ({ page, data }) => {
      const quote = { id: '39ea3a88-b8e1-4b4f-af28-08c1e5f79c53', client_id: data.account.id, lead_id: leadId,
        carrier: 'Revision Carrier', line_of_business: 'Auto', premium: 1500, effective_date: '2026-11-02', expiration_date: '2027-11-02',
        limits: 'Current limits', deductibles: 'Current deductible', notes: 'Current notes', status: 'accepted' as const,
        created_at: '2026-11-02T20:00:00Z', updated_at: '2026-11-02T21:00:00Z', updated_by: 'Second agent' };
      const entries: QuoteHistoryEntry[] = Array.from({ length: 101 }, (_, index) => ({
        id: String(101 - index), quote_id: quote.id, changed_at: '2026-11-02T21:00:00Z',
        snapshot: { ...quote, created_by: 'First agent', source_lead_id: leadId,
          premium: index === 100 ? 1200 : 1500, status: index === 100 ? 'draft' : 'accepted',
          notes: index === 100 ? 'Original unchanged quote notes' : 'Current notes' },
      }));
      const historyRequests: string[] = [];
      let failInitial = true, failOlder = true;
      await page.route('**/api/quote-options?**', async (route) => {
        const url = new URL(route.request().url());
        if (!url.searchParams.has('history_quote_id')) { await route.fulfill({ json: [quote] }); return; }
        historyRequests.push(url.search);
        const older = url.searchParams.has('before_id');
        if ((!older && failInitial) || (older && failOlder)) {
          if (older) failOlder = false; else failInitial = false;
          await route.fulfill({ status: 503, json: { message: 'Saved history temporarily unavailable' } }); return;
        }
        await route.fulfill({ json: older ? entries.slice(100) : entries.slice(0, 100) });
      });
      await page.goto(workspace === 'account' ? `/clients/${data.account.id}` : `/leads?lead=${leadId}`);
      await page.getByRole('button', { name: 'Quotes', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Manual quote options' });
      await expect(panel.getByRole('heading', { name: 'Revision Carrier · Auto' })).toBeVisible();
      expect(historyRequests).toHaveLength(0);
      await panel.getByRole('button', { name: 'Edit quote from Revision Carrier' }).click();
      await panel.locator('form[aria-label="Quote option form"] textarea').nth(2).fill('Unsaved draft stays here');
      await panel.getByRole('button', { name: 'View history for Revision Carrier' }).click();
      const history = panel.getByRole('region', { name: 'Quote history for Revision Carrier' });
      await expect(history.getByRole('alert')).toContainText('Saved history temporarily unavailable');
      await history.getByRole('button', { name: 'Retry history' }).click();
      await expect(history.locator('details')).toHaveCount(100);
      await history.locator('summary').first().click();
      await expect(history.getByText('Second agent', { exact: false }).first()).toBeVisible();
      await history.getByRole('button', { name: 'Load older revisions' }).click();
      await expect(history.getByRole('alert')).toBeVisible();
      await expect(history.locator('details')).toHaveCount(100);
      await history.getByRole('button', { name: 'Retry history' }).click();
      await expect(history.locator('details')).toHaveCount(101);
      await history.locator('summary').last().click();
      await expect(history.getByText('Original unchanged quote notes', { exact: true })).toBeVisible();
      await expect(history.getByText('$1,200.00', { exact: true })).toBeVisible();
      expect(historyRequests[2]).toContain('before_id=2');
      expect(historyRequests[3]).toContain('before_id=2');
      await expect(history.getByRole('button', { name: 'Load older revisions' })).toHaveCount(0);
      await panel.getByRole('button', { name: 'Hide history for Revision Carrier' }).click();
      await panel.getByRole('button', { name: 'View history for Revision Carrier' }).click();
      expect(historyRequests).toHaveLength(4);
      await expect(panel.locator('form[aria-label="Quote option form"] textarea').nth(2)).toHaveValue('Unsaved draft stays here');
      expect(data.policies).toHaveLength(0);
    });
  }
