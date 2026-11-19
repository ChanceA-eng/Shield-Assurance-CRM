import { test, expect, leadId } from './workspace-fixtures';
import { DEFAULT_OPPORTUNITY_SETTINGS, EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, type OpportunityOperations } from '@crm/shared';
import { evaluateOpportunity } from '../src/lib/opportunity-matching';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
const id = leadId, actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const day = new Date().toISOString().slice(0, 10);
const empty = (): OpportunityOperations => ({ watch: null, outcomes: [], evidence: [], relationships: [], held_lines: [], documents: [], requests: [] });
const dashboard = () => ({ settings: { config: DEFAULT_OPPORTUNITY_SETTINGS, revision: 0 }, watches: [], digests: [], searches: [], outcomes: [],
  scheduler: { configured: true, active: false, last_job_at: null }, can_manage: true });

test('owner targeting is configurable and saves without purchasing providers or changing appetite', async ({ page, settingsOwner: _owner }) => {
  const writes: Array<Record<string, unknown>> = [];
  let settings = { ...DEFAULT_OPPORTUNITY_SETTINGS }, revision = 0;
  await page.route('**/api/intelligence/operations**', async (route) => {
    if (route.request().method() === 'POST') { const input = route.request().postDataJSON(); writes.push(input); settings = input.config; revision++; }
    await route.fulfill({ json: { ...dashboard(), settings: { config: settings, revision } } });
  });
  await page.route('**/api/intelligence/sources**', (route) => route.fulfill({ json: { sources: [], can_manage: true } }));
  await page.goto('/settings?tab=intelligence&tool=targeting');
  await page.getByLabel('Industries', { exact: true }).fill('Restaurant, Contractor');
  await page.getByLabel('States (two-letter codes)').fill('AZ, NM');
  await page.getByLabel('Maximum digest items per agent').fill('6');
  await page.getByRole('button', { name: 'Save targeting' }).click();
  await expect(page.getByRole('status')).toContainText('Targeting saved');
  expect(writes).toHaveLength(1);
  expect(writes[0].config).toMatchObject({ industries: 'Restaurant, Contractor', states: 'AZ, NM', agent_capacity: 6, recurring_enabled: false });
  await page.reload();
  await expect(page.getByLabel('Industries', { exact: true })).toHaveValue('Restaurant, Contractor');
});

test('outcomes, watched evidence and questionnaire checklists persist with unchanged-response retries', async ({ page }) => {
  let ops = empty(), lost = true;
  const inputs: Array<Record<string, unknown>> = [];
  const dossier = { scope_key: `lead:${id}`, record_name: 'Synthetic business', version: 0, findings: EMPTY_DOSSIER_FINDINGS,
    observations: [], confirmations: [], observations_total: 0, history_total: 0, page: 0 };
  const profile = { ...EMPTY_OPPORTUNITY_PROFILE, source_reference: 'Synthetic authorized call', confirmed_on: day };
  await page.route('**/api/intelligence/opportunities**', (route) => route.fulfill({ json: { target: { type: 'lead', id }, record_name: 'Synthetic business',
    profile: { scope_key: `lead:${id}`, revision: 1, profile }, assessment: evaluateOpportunity(profile, [], dossier, day),
    evidence_token: 'current', evaluated_on: day, draft: null, agents: [{ user_id: actor, email: 'synthetic@example.test' }] } }));
  await page.route('**/api/intelligence/operations**', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON(); inputs.push(input);
      if (input.action === 'watch') ops.watch = { enabled: input.enabled, last_evaluated_at: null, next_due_at: day, error: null };
      if (input.action === 'outcome' && !ops.outcomes.some((row) => row.id === input.request_id)) ops.outcomes.push({ ...input.payload, id: input.request_id, actor_id: actor });
      if (input.action === 'outcome' && lost) { lost = false; await route.fulfill({ status: 503, json: { message: 'Response lost. Retry unchanged.' } }); return; }
      if (input.action === 'request') ops.requests.push({ id: input.request_id, questions: input.payload.questions, state: 'requested', response: '', source_as_of: null });
    }
    await route.fulfill({ json: ops });
  });
  await page.route('**/api/intelligence/questionnaire', (route) => route.fulfill({ json: { path: `/intelligence/questionnaire/${'a'.repeat(43)}` } }));
  await page.goto(`/leads/opportunities?type=lead&id=${id}`);
  const section = page.getByRole('region', { name: 'Opportunity evidence and outcomes' });
  await section.getByRole('button', { name: 'Watch this business' }).click();
  await expect(section.getByRole('button', { name: 'Stop watching this business' })).toBeVisible();
  await section.getByText('Record a business outcome', { exact: true }).click();
  await section.getByLabel('Acquisition source / campaign').fill('Authorized file');
  await section.getByRole('button', { name: 'Record outcome', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Response lost');
  await section.getByRole('button', { name: 'Record outcome', exact: true }).click();
  await expect(section.getByRole('listitem').filter({ hasText: `${day} · qualified · Authorized file` })).toBeVisible();
  const outcomes = inputs.filter((input) => input.action === 'outcome');
  expect(outcomes[0].request_id).toBe(outcomes[1].request_id);
  await section.getByText('Discovery questions and document requests', { exact: true }).click();
  await section.getByLabel('Questions / documents to request').fill('Which business coverage lines should we review?');
  await section.getByRole('button', { name: 'Save request checklist' }).click();
  await section.getByRole('button', { name: 'Create 7-day questionnaire link' }).click();
  await expect(section.getByLabel('Private questionnaire link', { exact: true })).toHaveValue(/\/intelligence\/questionnaire\//);
  expect(inputs.some((input) => input.action === 'send' || input.action === 'enroll')).toBe(false);
  ops = { ...ops };
});

test('controlled capture stages only deliberately selected business text and retries with the same identity', async ({ page }) => {
  const inputs: Array<Record<string, unknown>> = [];
  await page.route('**/api/intelligence/sources**', (route) => route.fulfill({ json: { sources: [{ id, name: 'Authorized business source', active: true }], can_manage: true } }));
  await page.route('**/api/intelligence/searches**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/intelligence/candidates**', (route) => route.fulfill({ json: { candidates: [], total: 0 } }));
  await page.route('**/api/intelligence/capture', async (route) => {
    inputs.push(route.request().postDataJSON());
    await route.fulfill(inputs.length === 1 ? { status: 503, json: { message: 'Capture response lost. Retry unchanged.' } } : { json: { batch_id: id, prospect_count: 1 } });
  });
  await page.goto('/leads/finder');
  await page.getByText('Add prospect data', { exact: true }).click();
  await page.getByText('Capture selected business information', { exact: true }).click();
  const form = page.getByRole('group', { name: 'Business capture', exact: true });
  await form.getByRole('combobox', { name: 'Approved source', exact: true }).selectOption(id);
  await form.getByLabel('Business name', { exact: true }).fill('Synthetic selected business');
  await form.getByLabel('Public source URL (no query tokens)').fill('https://example.test/business');
  await form.getByLabel('Explicitly selected business text').fill('Business-only selected text, authorized for retention.');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Capture for review' }).click();
  await expect(form.getByRole('alert')).toContainText('response lost');
  await page.reload();
  await page.getByText('Add prospect data', { exact: true }).click();
  await page.getByText('Capture selected business information', { exact: true }).click();
  await form.getByRole('combobox', { name: 'Approved source', exact: true }).selectOption(id);
  await form.getByLabel('Business name', { exact: true }).fill('Synthetic selected business');
  await form.getByLabel('Public source URL (no query tokens)').fill('https://example.test/business');
  await form.getByLabel('Explicitly selected business text').fill('Business-only selected text, authorized for retention.');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Capture for review' }).click();
  await expect(form.getByRole('status')).toContainText('Captured for candidate review');
  expect(inputs[0].request_id).toBe(inputs[1].request_id);
});

test('public questionnaire shows no CRM shell and requires business-response consent without sending anything', async ({ page }) => {
  const token = 'b'.repeat(43), writes: Array<Record<string, unknown>> = [];
  await page.route(`**/api/intelligence/questionnaire/${token}`, async (route) => {
    if (route.request().method() === 'POST') writes.push(route.request().postDataJSON());
    await route.fulfill({ json: route.request().method() === 'POST' ? { submitted: true } : { questions: 'Which coverage lines and timing should your agent review?', submitted: false } });
  });

  await page.goto(`/intelligence/questionnaire/${token}`);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByLabel('Your business response').fill('Please review general liability before the next renewal.');
  await expect(page.getByRole('button', { name: 'Submit for agent review' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit for agent review' }).click();
  await expect(page.getByRole('status')).toContainText('response was recorded for agent review');
  expect(writes).toEqual([{ response: 'Please review general liability before the next renewal.', consent: true }]);
});

test('real scoped outcomes and revocable questionnaires persist without sending or confirming prospect claims', async ({ context, settingsOwner: _owner }) => {
    test.skip(process.env.CRM_INTELLIGENCE_QA_ALLOWED !== '1', 'Requires explicitly authorized disposable OIP database verification.');
    test.setTimeout(120000);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Configured private CRM access is required.');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
    const account = randomUUID(), scope = `client:${account}`, outcome = randomUUID(), requestId = randomUUID();
    const target = { type: 'client', id: account };
    const operation = (action: string, payload: object, request_id = randomUUID()) => context.request.post('/api/intelligence/operations', { data: { ...target, action, payload, request_id } });
    try {
      const inserted = await db.from('clients').insert({ id: account, full_name: 'Synthetic OIP release verification', source: 'Disposable OIP verification' });
      if (inserted.error) throw new Error(inserted.error.message);
      const payload = { stage: 'qualified', occurred_on: day, source: 'Synthetic OIP verification', reason: '', cost: 0, premium: null };
      const recorded = await operation('outcome', payload, outcome);
      expect(recorded.status(), await recorded.text()).toBe(200);
      expect((await operation('outcome', payload, outcome)).status()).toBe(200);
      const corrected = await operation('outcome', { ...payload, cost: 5, supersedes: outcome });
      expect(corrected.status(), await corrected.text()).toBe(200);
      const requested = await operation('request', { questions: 'Which business coverage lines should your agent review?' }, requestId);
      expect(requested.status(), await requested.text()).toBe(200);
      const shared = await context.request.post('/api/intelligence/questionnaire', { data: { ...target, request_id: requestId, revoke: false } });
      expect(shared.status(), await shared.text()).toBe(200);
      const link = await shared.json() as { path: string };
      const token = link.path.split('/').pop() ?? '';
      const endpoint = `/api/intelligence/questionnaire/${token}`;
      const publicView = await context.request.get(endpoint);
      expect(publicView.status()).toBe(200);
      expect(Object.keys(await publicView.json()).sort()).toEqual(['expires_at', 'questions', 'submitted']);
      const origin = new URL(publicView.url()).origin;
      const answer = { response: 'Please review general liability.', consent: true };
      expect((await context.request.post(endpoint, { data: answer, headers: { origin } })).status()).toBe(200);
      expect((await context.request.post(endpoint, { data: answer, headers: { origin } })).status()).toBe(200);
      expect((await context.request.post(endpoint, { data: { ...answer, response: 'Changed answer' }, headers: { origin } })).status()).toBe(409);
      const stored = await context.request.get(`/api/intelligence/operations?type=client&id=${account}`);
      expect(stored.status(), await stored.text()).toBe(200);
      const operations = await stored.json() as OpportunityOperations;
      expect(operations.outcomes).toHaveLength(1);
      expect(operations.outcomes[0].cost).toBe(5);
      expect(operations.requests[0].state).toBe('responded');
      expect((await context.request.post('/api/intelligence/questionnaire', { data: { ...target, request_id: requestId, revoke: true } })).status()).toBe(200);
      expect((await context.request.get(endpoint)).status()).toBe(404);
    } finally {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('delete from opportunity_questionnaires where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from opportunity_operation_events where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from intelligence_dossiers where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from clients where id=$1::uuid', account);
        });
      } finally { await prisma.$disconnect(); }
    }
});
