import { test, expect, leadId } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { WcEntry } from '../src/lib/workers-comp';

test('workers comp review persists, corrects and removes real private API facts without enrolling or sending', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase QA configuration required.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), entry_id = randomUUID(), email = `wc-${id}@example.invalid`;
  const created = await db.from('leads').insert({ id, full_name: 'Synthetic WC API employer', email, status: 'new', source: 'browser_qa' });
  if (created.error) throw new Error('Could not create the disposable WC API record.');
  const evidence = { kind: 'loss_run', source_name: 'Synthetic loss summary', source_date: new Date().toISOString().slice(0, 10),
    employer_name: 'Synthetic WC API employer', employer_address: '1 Test St, Tucson, AZ', identity: 'confirmed',
    fields: { claim_count: '0', paid_losses: '0', loss_from: '2025-01-01', loss_to: '2025-12-31', loss_completeness: 'complete' }, pages: { claim_count: 2 } };
  try {
    const initial = await context.request.get(`/api/workers-comp?type=lead&id=${id}`);
    expect(initial.status()).toBe(200);
    expect(initial.headers()['cache-control']).toContain('no-store');
    expect(await initial.json()).toMatchObject({ entries: [] });
    const saved = await context.request.put('/api/workers-comp', { data: { type: 'lead', id, entry_id, revision: 0, evidence } });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).entries[0]).toMatchObject({ revision: 1, evidence: { fields: { claim_count: '0' } } });
    const stale = await context.request.put('/api/workers-comp', { data: { type: 'lead', id, entry_id, revision: 0, evidence } });
    expect(stale.status()).toBe(409);
    const corrected = await context.request.put('/api/workers-comp', { data: { type: 'lead', id, entry_id, revision: 1,
      evidence: { ...evidence, source_name: 'Corrected synthetic loss summary' } } });
    expect(corrected.status()).toBe(200);
    const matched = await context.request.post('/api/workers-comp', { data: { type: 'lead', id } });
    expect(matched.status()).toBe(200);
    expect(Array.isArray((await matched.json()).markets)).toBe(true);
    const removed = await context.request.delete('/api/workers-comp', { data: { type: 'lead', id, entry_id, revision: 2 } });
    expect(removed.status()).toBe(200);
    expect(await removed.json()).toMatchObject({ entries: [] });
  } finally {
    const removed = await db.from('leads').delete().eq('id', id).eq('email', email);
    if (removed.error) throw new Error('Could not remove the disposable WC API record.');
    const audit = await db.from('agency_audit').delete().eq('target_id', id).in('action',
      ['workers_comp_viewed', 'workers_comp_source_reviewed', 'workers_comp_source_removed']);
    if (audit.error) throw new Error('Could not remove disposable WC API audit fixtures.');
  }
});

test('workers comp document reading stays on-device and cites suggested totals before saving', async ({ page }) => {
  test.setTimeout(90000);
  const mutations: unknown[] = [];
  await page.route('**/api/workers-comp**', async (route) => {
    if (route.request().method() !== 'GET') mutations.push(route.request().postDataJSON());
    await route.fulfill({ json: { entries: [], record_name: 'Synthetic WC employer', record_address: '1 Test St, Tucson, AZ' } });
  });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: "Workers' comp", exact: true });
  await panel.getByRole('button', { name: 'Add document facts' }).click();
  await panel.getByRole('combobox', { name: 'Document type', exact: true }).selectOption('loss_run');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic document canvas unavailable.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000'; context.font = '32px Arial';
    ['EMPLOYER LOSS SUMMARY', 'Total claims: 0', 'Total paid: $0.00'].forEach((line, index) => context.fillText(line, 40, 70 + index * 75));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const external: string[] = [], uploaded: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['blob:', 'data:'].includes(url.protocol) && url.origin !== new URL(page.url()).origin) external.push(url.origin);
    if (request.method() !== 'GET' && request.postData()?.includes('EMPLOYER LOSS SUMMARY')) uploaded.push(url.pathname);
  });
  await panel.getByLabel('Read a document (optional)').setInputFiles({
    name: 'synthetic-employer-summary.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect(panel.getByLabel('Total claims', { exact: true })).toHaveValue('0', { timeout: 60000 });
  await expect(panel.getByLabel('Source page for Total claims', { exact: true })).toHaveValue('1');
  expect(mutations).toEqual([]);
  expect(external).toEqual([]);
  expect(uploaded).toEqual([]);
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('private workers comp review retains failed edits, saves a reported zero and reloads without sharing it', async ({ page, data }) => {
  let entries: WcEntry[] = [], fail = true;
  const calls: string[] = [];
  await page.route('**/api/workers-comp**', async (route) => {
    calls.push(route.request().method());
    if (route.request().method() === 'PUT') {
      if (fail) { fail = false; await route.fulfill({ status: 503, json: { message: 'Save could not finish. Please retry.' } }); return; }
      const body = route.request().postDataJSON();
      entries = [{ id: body.entry_id, revision: 1, evidence: body.evidence, updated_at: new Date().toISOString() }];
    }
    await route.fulfill({ json: { entries, record_name: 'Synthetic WC employer', record_address: '1 Test St, Tucson, AZ' } });
  });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: "Workers' comp", exact: true });
  await expect(panel.getByText('No workers\' comp documents added.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Add document facts' }).click();
  await panel.getByRole('combobox', { name: 'Document type', exact: true }).selectOption('loss_run');
  await panel.getByLabel('Source name', { exact: true }).fill('Authorized employer loss summary');
  await panel.getByLabel('Document report date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await panel.getByRole('combobox', { name: 'Business match', exact: true }).selectOption('confirmed');
  await panel.getByLabel('Loss period starts', { exact: true }).fill('2025-01-01');
  await panel.getByLabel('Loss period ends', { exact: true }).fill('2025-12-31');
  await panel.getByLabel('Total claims', { exact: true }).fill('0');
  await panel.getByRole('combobox', { name: 'Loss history provided', exact: true }).selectOption('partial');
  await panel.getByRole('button', { name: 'Save reviewed facts' }).click();
  await expect(panel.getByRole('alert')).toContainText('Save could not finish');
  await expect(panel.getByLabel('Total claims', { exact: true })).toHaveValue('0');
  await panel.getByRole('button', { name: 'Save reviewed facts' }).click();
  await expect(panel.getByText('Reviewed facts saved.', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByText('Authorized employer loss summary', { exact: true })).toBeVisible();
  await expect(panel.getByText('Missing years or fields are unknown, not zero losses.', { exact: false })).toBeVisible();
  expect(entries[0].evidence.fields).toMatchObject({ claim_count: '0', loss_completeness: 'partial' });
  expect(entries[0].evidence.fields.open_claims).toBeUndefined();
  expect(calls.filter((method) => method === 'PUT')).toHaveLength(2);
  expect(data.requests.some((request) => /outbox|draft-outreach|\/outreach\/run/.test(request))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: 'Review / correct' })).toBeVisible();
});

test('unsaved Finder businesses get Arizona resources without a private record request', async ({ page }) => {
  let privateCalls = 0;
  await page.route('**/api/workers-comp**', async (route) => { privateCalls++; await route.fulfill({ status: 500, json: {} }); });
  await page.route('**/api/intelligence/business-search**', async (route) => route.fulfill({ json: {
    run_id: 'synthetic', businesses: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic AZ employer', observations: [] }],
    coverage: [], next_page: null,
  } }));
  await page.route('**/api/intelligence/business-research**', async (route) => route.fulfill({ json: {
    business: { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic AZ employer', observations: [] },
    linked_record: null, job: { state: 'complete', result: { insights: [], context: [], coverage: [] } },
  } }));
  await page.goto('/leads/finder', { waitUntil: 'domcontentloaded' });
  await page.getByText('Synthetic AZ employer', { exact: true }).first().click();
  await page.getByRole('tab', { name: 'Workers’ comp', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Arizona coverage resources' })).toHaveAttribute('href', 'https://www.azica.gov/obtaining-workers-compensation-coverage-information');
  await expect(page.getByText('Open a saved lead or account to add private', { exact: false })).toBeVisible();
  expect(privateCalls).toBe(0);
});
