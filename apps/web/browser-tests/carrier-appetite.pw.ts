import { test, expect } from './workspace-fixtures';
import type { CarrierAppetiteDocument, CarrierAppetiteValues } from '@crm/shared';
import type { Route } from '@playwright/test';
import { extractCarrierAppetite, parseCarrierAppetite } from '../src/lib/carrier-appetite';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

async function mockReading(route: Route, saved: CarrierAppetiteDocument | null = null): Promise<void> {
  const pages: Array<{ page: number; text: string }> = saved?.pages ?? route.request().postDataJSON().pages;
  const text = pages[0].text;
  let rules = saved?.values.rules ?? extractCarrierAppetite(pages);
  if (text.includes('Synthetic Column Carrier')) rules = [
    { id: '98dd7da7-3b36-4a71-9e4d-beb3ad281ab2', criterion: 'Book stores', decision: 'preferred', page: 1, excerpt: '- Book stores' },
    { id: '5cdd2873-cac1-4f08-b511-cfe27e27c100', criterion: 'High-rise demolition', decision: 'excluded', page: 1,
      excerpt: text.slice(text.indexOf('8 High-rise'), text.indexOf('demolition') + 'demolition'.length) },
  ];
  const values = parseCarrierAppetite({ carrier: /^Carrier:\s*(.+)$/m.exec(text)?.[1].trim() ?? 'Synthetic Carrier', title: 'Guide', line: '', states: '', effective_on: '', expires_on: '',
    access: 'direct', rules, ...saved?.values,
    interpretation: { source_hash: 'a'.repeat(64), version: 'guide-ai-v1', summary: 'Synthetic AI guide summary.' } }, pages);
  await route.fulfill({ json: { values } });
}

function carrierPdf(columns = false, tightTable = false, fleetTag = ''): Buffer {
  const lines = fleetTag ? [`Carrier: Synthetic QA Fleet ${fleetTag}`, 'COMMERCIAL AUTO', 'States: AZ, NV',
    'ELIGIBLE CLASSES', 'Fleets with at least 11 power units are eligible.', 'CONTACT US', '800-555-0100']
    .map((text, index) => ({ text, x: 40, y: 750 - index * 25 })) : tightTable ? [
    { text: 'Carrier: Synthetic Table Carrier', x: 40, y: 750 },
    { text: 'Industry', x: 40, y: 720 }, { text: 'Appetite', x: 100, y: 720 },
    { text: 'Book stores', x: 40, y: 690 }, { text: 'Preferred', x: 100, y: 690 },
  ] : columns ? [
    { text: 'Carrier: Synthetic Column Carrier', x: 40, y: 750 },
    { text: 'TARGET CLASSES', x: 40, y: 720 }, { text: 'HOW TO SUBMIT', x: 430, y: 720 },
    { text: 'RETAIL', x: 40, y: 690 }, { text: 'SERVICE BUSINESSES', x: 240, y: 690 },
    { text: 'Submit through the portal', x: 430, y: 665 },
    { text: '- Book stores', x: 40, y: 660 }, { text: '- Equipment repair', x: 240, y: 660 },
    { text: 'EXPOSURES TO AVOID', x: 40, y: 600 },
    { text: '8 Explosives', x: 40, y: 570 }, { text: '8 High-rise', x: 240, y: 570 },
    { text: 'demolition', x: 247, y: 550 },
  ] : ['Carrier: Synthetic PDF Carrier', 'Product: General liability', 'States: AZ', 'Effective date: 2026-01-01',
    'PREFERRED CLASSES', 'Restaurants without delivery', 'PROHIBITED CLASSES', 'Roofing contractors']
    .map((text, index) => ({ text, x: 40, y: 750 - index * 25 }));
  const stream = lines.map(({ text, x, y }) => `BT /F1 11 Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`).join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

test('real carrier PDF extracts cited appetite without external processing or automatic saving', async ({ page }) => {
  test.setTimeout(90000);
  await page.route('**/api/carrier-appetite**', async (route) => {
    await route.fulfill({ json: { documents: [], can_manage: true, has_more: false, overlapping_sources: [] } });
  });
  await page.goto('/rashi/carrier-appetite');
  const external: string[] = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const authenticationRead = request.method() === 'GET' && url.pathname === '/auth/v1/user'
      && url.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://unused.invalid').origin;
    if (url.origin !== new URL(page.url()).origin && !authenticationRead) external.push(request.url());
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.getByLabel('Carrier appetite document').setInputFiles({ name: 'synthetic-appetite.pdf', mimeType: 'application/pdf', buffer: carrierPdf() });
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('Synthetic PDF Carrier', { timeout: 60000 });
  await page.getByText('View or correct extracted entries (optional)', { exact: true }).click();
  await expect(page.getByLabel('Rule 1', { exact: true })).toHaveValue('PREFERRED CLASSES: Restaurants without delivery');
  await expect(page.getByLabel('Decision 2', { exact: true })).toHaveValue('excluded');
  await page.getByRole('button', { name: 'Source page 1' }).first().click();
  await expect(page.getByLabel('Exact source excerpt')).toHaveValue('Restaurants without delivery');
  expect(writes).toEqual([]); expect(external).toEqual([]);
});

test('carrier guidance reads locally, retries private saves, survives reload and invalidates approval on edit', async ({ page }) => {
  let saved: CarrierAppetiteDocument | null = null;
  let uploadCount = 0;
  let saveCount = 0;
  let loseFirstResponse = true;
  const saves: Array<{ id: string; revision: number; values: CarrierAppetiteValues }> = [];
  await page.route('**/private-carrier-upload', async (route) => {
    uploadCount++;
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route('**/api/carrier-appetite**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({ json: url.searchParams.has('id') ? { document: saved, can_manage: true, overlapping_sources: [] }
        : { documents: saved ? [saved] : [], can_manage: true, has_more: false, overlapping_sources: [] } });
      return;
    }
    const body = request.postDataJSON();
    if (body.action === 'interpret') return mockReading(route, saved);
    if (body.action === 'reserve') {
      await route.fulfill({ json: { signed_url: new URL('/private-carrier-upload', url).href, content_type: 'text/plain' } }); return;
    }
    if (body.action === 'save') {
      saveCount++; saves.push(body);
      if (!saved || saved.revision === body.revision) {
        saved = { id: body.id, revision: body.revision + 1, state: 'draft', values: body.values, pages: body.pages,
          file_name: 'synthetic-appetite.txt', storage_path: 'private-test-source', approved_by: null, approved_at: null };
      }
      if (loseFirstResponse) {
        loseFirstResponse = false; await route.fulfill({ status: 503, json: { message: 'Temporary response failure. Retry the unchanged save.' } }); return;
      }
    } else if (body.action === 'activate' && saved) {
      saved = { ...saved, revision: saved.revision + 1, state: 'active', approved_by: 'qa-owner', approved_at: new Date().toISOString() };
    } else if (body.action === 'withdraw' && saved) {
      saved = { ...saved, revision: saved.revision + 1, state: 'withdrawn', approved_by: null };
    }
    await route.fulfill({ json: saved });
  });
  await page.goto('/rashi/carrier-appetite');
  await expect(page.getByLabel('Carrier appetite document')).toBeVisible();
  await page.getByLabel('Carrier appetite document').setInputFiles({ name: 'synthetic-appetite.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Carrier: Synthetic Carrier\nPREFERRED CLASSES\nRestaurants without delivery\nPROHIBITED CLASSES\nRoofing contractors\nLIMITS\nMaximum $2,000,000') });
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('Synthetic Carrier');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Rule 1', { exact: true })).not.toBeVisible();
  await page.getByText('View or correct extracted entries (optional)', { exact: true }).click();
  await expect(page.getByLabel('Decision 1', { exact: true })).toHaveValue('preferred');
  await expect(page.getByLabel('Decision 2', { exact: true })).toHaveValue('excluded');
  await expect(page.getByLabel('Decision 3', { exact: true })).toHaveValue('needs_review');
  expect(saveCount).toBe(0);
  await expect(page.getByLabel('rights_reference', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /I may store/ })).toHaveCount(0);
  await expect(page.getByLabel('access_reference', { exact: true })).toHaveCount(0);
  await page.getByLabel('Agency carrier access').selectOption('direct');
  await page.getByText('Add automatic matching (optional)', { exact: true }).first().click();
  await page.getByLabel('Matching business field').first().selectOption('has_delivery');
  await page.getByLabel('Documented comparison value').first().selectOption('no');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary response failure' })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect(uploadCount).toBe(1); expect(saveCount).toBe(2); expect(saves[0].id).toBe(saves[1].id);
  expect(saves[0].values.rules[2].excerpt).toBe('Maximum $2,000,000');
  expect(saves[0].values.effective_on).toBe('');
  expect(saves[0].values.expires_on).toBe('');
  expect(saves[0].values.rules[2].decision).toBe('needs_review');
  await page.getByRole('button', { name: 'Use this guide', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Guide ready for carrier matching');
  await page.reload();
  await page.getByRole('button', { name: /Synthetic Carrier.*synthetic-appetite/ }).click();
  await page.getByText('View or correct extracted entries (optional)', { exact: true }).click();
  await expect(page.getByLabel('Rule 2', { exact: true })).toContainText('Roofing contractors');
  await expect(page.getByRole('button', { name: 'Activate reviewed rules' })).toHaveCount(0);
  await page.getByLabel('title', { exact: true }).fill('Owner revised title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use this guide', exact: true })).toBeEnabled();
  expect(saves.at(-1)?.values.title).toBe('Owner revised title');
});

test('an undated column guide saves and enables in one click without opening the rule editor', async ({ page }) => {
  let saved: CarrierAppetiteDocument | null = null;
  const actions: string[] = [];
  await page.route('**/private-carrier-upload', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('**/api/carrier-appetite**', async (route) => {
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url());
      if (url.searchParams.has('download')) return route.fulfill({ contentType: 'application/octet-stream', body: carrierPdf(true) });
      return route.fulfill({ json: url.searchParams.has('id') ? { document: saved, can_manage: true, overlapping_sources: [] }
        : { documents: saved ? [saved] : [], can_manage: true, has_more: false, overlapping_sources: [] } });
    }
    const body = route.request().postDataJSON(); actions.push(body.action);
    if (body.action === 'interpret') return mockReading(route, saved);
    if (body.action === 'reserve') return route.fulfill({ json: { signed_url: new URL('/private-carrier-upload', route.request().url()).href, content_type: 'application/pdf' } });
    if (body.action === 'save') {
      expect(body.values.effective_on).toBe(''); expect(body.values.expires_on).toBe('');
      expect(body.values.line).toBe(''); expect(body.values.states).toBe('');
      expect(body.values.rules.some((rule: { criterion: string }) => /portal|submit/i.test(rule.criterion))).toBe(false);
      expect(body.values.rules.find((rule: { criterion: string }) => rule.criterion === 'High-rise demolition')?.decision).toBe('excluded');
      saved = { id: body.id, revision: body.revision + 1, state: 'draft', values: body.values, pages: body.pages,
        file_name: 'column-guide.pdf', storage_path: 'private-test-source', approved_by: null, approved_at: null };
    } else if (body.action === 'activate' && saved) {
      expect(body.review_confirmed).toBeUndefined();
      saved = { ...saved, revision: saved.revision + 1, state: 'active', approved_by: 'qa-owner', approved_at: new Date().toISOString() };
    }
    return route.fulfill({ json: saved });
  });
  await page.goto('/rashi/carrier-appetite');
  await page.getByLabel('Carrier appetite document').setInputFiles({ name: 'column-guide.pdf', mimeType: 'application/pdf', buffer: carrierPdf(true) });
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('Synthetic Column Carrier');
  await expect(page.getByLabel('Rule 1', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and use guide', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Guide ready for carrier matching');
  expect(actions).toEqual(['reserve', 'interpret', 'save', 'activate']);
  await page.reload();
  await page.getByRole('button', { name: /Synthetic Column Carrier.*column-guide/ }).click();
  await page.getByRole('button', { name: 'Re-read original guide', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('entries rebuilt from the original guide');
  await page.getByRole('button', { name: 'Save and use guide', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Guide ready for carrier matching');
});

test('multi-carrier source sections remain separate reviews, never a blended appetite', async ({ page }) => {
  await page.route('**/api/carrier-appetite**', async (route) => {
    await route.fulfill({ json: { documents: [], can_manage: true, has_more: false, overlapping_sources: [] } });
  });
  await page.goto('/rashi/carrier-appetite');
  await page.getByLabel('Carrier appetite document').setInputFiles({ name: 'multi-carrier.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Carrier: First Carrier\nELIGIBLE CLASSES\nRestaurants\nCarrier: Second Carrier\nPROHIBITED CLASSES\nRoofing contractors') });
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('');
  await page.getByLabel('Carrier from source').selectOption('First Carrier');
  await page.getByText('View or correct extracted entries (optional)', { exact: true }).click();
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('First Carrier');
  await expect(page.getByLabel('Rule 1', { exact: true })).toHaveValue('ELIGIBLE CLASSES: Restaurants');
  await expect(page.getByLabel('Rule 2', { exact: true })).toHaveCount(0);
  await page.getByLabel('Carrier from source').selectOption('Second Carrier');
  await expect(page.getByLabel('Rule 1', { exact: true })).toHaveValue('PROHIBITED CLASSES: Roofing contractors');
  await expect(page.getByLabel('Decision 1', { exact: true })).toHaveValue('excluded');
});

test('tight PDF columns cannot block saving with an internal source-excerpt error', async ({ page }) => {
  let saved: CarrierAppetiteDocument | null = null;
  await page.route('**/private-carrier-upload', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('**/api/carrier-appetite**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { documents: [], can_manage: true, has_more: false, overlapping_sources: [] } });
    const body = route.request().postDataJSON();
    if (body.action === 'interpret') return mockReading(route, saved);
    if (body.action === 'reserve') return route.fulfill({ json: { signed_url: new URL('/private-carrier-upload', route.request().url()).href, content_type: 'application/pdf' } });
    if (body.action === 'save') {
      expect(body.values.rules).toHaveLength(1);
      expect(body.values.rules[0].excerpt).toBe('Book stores Preferred');
      expect(body.pages[0].text).toContain(body.values.rules[0].excerpt);
      expect(body.values.unresolved_entries).toBeUndefined();
      saved = { id: body.id, revision: 1, state: 'draft', values: body.values, pages: body.pages,
        file_name: 'tight-table.pdf', storage_path: 'private-test-source', approved_by: null, approved_at: null };
    } else if (body.action === 'activate' && saved) {
      saved = { ...saved, revision: 2, state: 'active', approved_by: 'qa-owner', approved_at: new Date().toISOString() };
    }
    return route.fulfill({ json: saved });
  });
  await page.goto('/rashi/carrier-appetite');
  await page.getByLabel('Carrier appetite document').setInputFiles({ name: 'tight-table.pdf', mimeType: 'application/pdf', buffer: carrierPdf(false, true) });
  await expect(page.getByLabel('carrier', { exact: true })).toHaveValue('Synthetic Table Carrier');
  await page.getByRole('button', { name: 'Save and use guide', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Guide ready for carrier matching');
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
});

test('agent view cannot upload or activate guidance; overlapping carrier documents stay explicit', async ({ page }) => {
  await page.route('**/api/carrier-appetite**', async (route) => {
    await route.fulfill({ json: { documents: [{ id: 'one', revision: 2, state: 'active', file_name: 'guide.txt',
      values: { carrier: 'Synthetic Carrier', title: 'Reviewed guide', effective_on: '2026-01-01', expires_on: '', access: 'unconfirmed' } }],
    can_manage: false, has_more: false, overlapping_sources: ['one'] } });
  });
  await page.goto('/rashi/carrier-appetite');
  await expect(page.getByText('Overlapping coverage guides: check differences')).toBeVisible();
  await expect(page.getByLabel('Carrier appetite document')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate reviewed rules' })).toHaveCount(0);
  await expect(page.getByText(/Agency access unconfirmed/)).toBeVisible();
});

test('an unmatched extracted entry is retained as a warning, not a save blocker or matching rule', async ({ page }) => {
    let saved: CarrierAppetiteDocument = {
      id: '3b4e236a-cb1e-4e9e-90e2-b0de1cc184cc', revision: 1, state: 'draft',
      values: { carrier: 'Synthetic Unclear Carrier', title: 'Unclear guide', line: '', states: '', effective_on: '', expires_on: '',
        access: 'direct', access_reference: '', rights_reference: '', rules: [{
          id: '61fd347f-49a6-4672-8bda-83f24287490f', criterion: 'Unclear restriction', decision: 'excluded', page: 1, excerpt: 'Unmatched extracted text',
        }] },
      pages: [{ page: 1, text: 'Original guide with a difficult table.' }],
      file_name: 'unclear.pdf', storage_path: 'private-test-source', approved_by: null, approved_at: null,
    };
    const actions: string[] = [];
    await page.route('**/api/carrier-appetite**', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id')
        ? { document: saved, can_manage: true, overlapping_sources: [] } : { documents: [saved], can_manage: true, has_more: false, overlapping_sources: [] } });
      const body = route.request().postDataJSON(); actions.push(body.action);
      if (body.action === 'interpret') return mockReading(route, saved);
      if (body.action === 'save') {
        expect(body.values.rules).toEqual([]);
        expect(body.values.unresolved_entries).toHaveLength(1);
        expect(body.values.unresolved_entries[0].criterion).toBe('Unclear restriction');
        expect(body.pages).toEqual(saved.pages);
        saved = { ...saved, revision: body.revision + 1, values: body.values };
      } else if (body.action === 'activate') {
        saved = { ...saved, revision: body.revision + 1, state: 'active', approved_by: 'qa-owner', approved_at: new Date().toISOString() };
      }
      return route.fulfill({ json: saved });
    });
    await page.goto('/rashi/carrier-appetite');
    await page.getByRole('button', { name: /Synthetic Unclear Carrier.*Unclear guide/ }).click();
    await page.getByRole('button', { name: 'Use this guide', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Guide ready for carrier matching' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '1 entry could not be read reliably' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    expect(actions).toEqual(['interpret', 'save', 'activate']);
});

test('saved auto and property guides are read once in bulk and keep their separate coverage', async ({ page }) => {
  const base: CarrierAppetiteValues = { carrier: 'Synthetic Shared Carrier', title: 'Fleet', line: '', states: '', effective_on: '', expires_on: '',
    access: 'direct', access_reference: '', rights_reference: '', rules: [] };
  const guides: CarrierAppetiteDocument[] = ['Auto', 'Property'].map((line, index) => ({
    id: `guide-${index}`, revision: 2, state: 'active', values: { ...base, title: line },
    file_name: `${line}.pdf`, storage_path: 'private-test-source', pages: [{ page: 1, text: line }],
    approved_by: 'qa-owner', approved_at: '2026-11-01T00:00:00Z',
  }));
  const reads: string[] = [];
  await page.route('**/api/carrier-appetite**', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    if (route.request().method() === 'GET') return route.fulfill({ json: id ? { document: guides.find((entry) => entry.id === id) }
      : { documents: guides, has_more: false, can_manage: true, overlapping_sources: [] } });
    const body = route.request().postDataJSON();
    expect(body.action).toBe('interpret_saved'); reads.push(body.id);
    const guide = guides.find((entry) => entry.id === body.id)!;
    guide.values = { ...guide.values, line: guide.values.title === 'Auto' ? 'commercial auto' : 'commercial property',
      interpretation: { version: 'guide-ai-v1', source_hash: 'a'.repeat(64), summary: 'Reusable synthetic criteria.' } };
    return route.fulfill({ json: { document: guide } });
  });
  await page.goto('/rashi/carrier-appetite');
  await page.getByRole('button', { name: 'Read saved guides with AI', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('2 guides read');
  await expect(page.getByText('commercial auto', { exact: true })).toBeVisible();
  await expect(page.getByText('commercial property', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Read saved guides with AI', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('already have an AI reading');
  expect(reads).toEqual(['guide-0', 'guide-1']);
});

test.describe('live synthetic AI guide contract', () => {
  test.skip(process.env.CRM_CARRIER_AI_QA_ALLOWED !== '1', 'Explicit opt-in required for a real OpenAI call and disposable guide writes.');
  test('original PDF is interpreted, reused and persisted without another AI reading', async ({ page, settingsOwner }) => {
    void settingsOwner;
    test.setTimeout(150000);
    const id = randomUUID(), pdf = carrierPdf(false, false, id), name = 'synthetic-ai-qa.pdf';
    const hash = createHash('sha256').update(pdf).digest('hex');
    const storagePath = `carrier-appetite/${id}/${name}`;
    const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const post = async (data: object): Promise<unknown> => {
      const response = await page.request.post('/api/carrier-appetite', { data, timeout: 115000 });
      if (!response.ok()) throw new Error(`Synthetic guide API failed (${response.status()}): ${(await response.json()).message}`);
      return response.json();
    };
    try {
      await post({ id, revision: 0, action: 'reserve', file_name: name, file_size: pdf.length, content_type: 'application/pdf' });
      const upload = await admin.storage.from('account-documents').upload(storagePath, pdf, { contentType: 'application/pdf' });
      if (upload.error) throw new Error(`Synthetic upload failed: ${upload.error.message}`);
      const pages = [{ page: 1, text: `Carrier: Synthetic QA Fleet ${id}\nCOMMERCIAL AUTO\nStates: AZ, NV\nELIGIBLE CLASSES\nFleets with at least 11 power units are eligible.\nCONTACT US\n800-555-0100` }];
      const response = await page.request.post('/api/carrier-appetite', { data: { id, revision: 0, action: 'interpret', pages }, timeout: 115000 });
      if (!response.ok()) throw new Error(`Synthetic AI reading failed (${response.status()}): ${(await response.json()).message}`);
      const { values }: { values: CarrierAppetiteValues } = await response.json();
      expect(values.line.toLowerCase()).toBe('commercial auto');
      expect(values.rules.some((rule) => rule.predicate?.field === 'power_units' && rule.predicate.value === '11')).toBe(true);
      expect(values.rules.every((rule) => !/800-555|CONTACT US/.test(rule.criterion))).toBe(true);
      const cachedBefore = await admin.from('carrier_appetite_ai_readings').select('updated_at').eq('source_hash', hash).single();
      if (cachedBefore.error) throw new Error('Synthetic AI reading was not cached.');
      const repeated = await page.request.post('/api/carrier-appetite', { data: { id, revision: 0, action: 'interpret', pages } });
      expect(repeated.status()).toBe(200);
      expect((await repeated.json()).values).toEqual(values);
      await post({ id, revision: 0, action: 'save', pages, values: { ...values, access: 'direct' } });
      await post({ id, revision: 1, action: 'activate' });
      await post({ id, revision: 2, action: 'interpret_saved' });
      const persisted = await admin.from('carrier_appetite_documents').select('state,revision,values,pages').eq('id', id).single();
      if (persisted.error) throw new Error('Synthetic guide did not persist.');
      expect(persisted.data).toMatchObject({ state: 'active', revision: 4, pages });
      expect(persisted.data.values.interpretation.source_hash).toBe(hash);
      const cachedAfter = await admin.from('carrier_appetite_ai_readings').select('updated_at').eq('source_hash', hash).single();
      if (cachedAfter.error) throw new Error('Synthetic AI cache could not be verified.');
      expect(cachedAfter.data.updated_at).toBe(cachedBefore.data.updated_at);
    } finally {
      try {
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`delete from carrier_appetite_revisions where document_id=${id}::uuid`;
          await tx.$executeRaw`delete from carrier_appetite_documents where id=${id}::uuid`;
          await tx.$executeRaw`delete from carrier_appetite_ai_readings where source_hash=${hash} and reader_version='guide-ai-v1'`;
        });
        const removed = await admin.storage.from('account-documents').remove([storagePath]);
        if (removed.error) throw new Error('Synthetic guide storage cleanup failed.');
      } finally { await db.$disconnect(); }
    }
  });
});
