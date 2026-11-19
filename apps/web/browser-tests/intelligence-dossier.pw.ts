import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { EMPTY_DOSSIER_FINDINGS, type IntelligenceDossier } from '@crm/shared';
import { test, expect, leadId } from './workspace-fixtures';

test('mobile dossier confirms findings, shows evidence and retains edits on stale save', async ({ page }) => {
  page.on('pageerror', (error) => console.error('Dossier browser error:', error));
  let dossier: IntelligenceDossier = {
    scope_key: `lead:${leadId}`, record_name: 'Leo Example', version: 0, findings: { ...EMPTY_DOSSIER_FINDINGS },
    confirmations: [], history_total: 0, observations_total: 26, page: 0,
    observations: [{
      id: '168413e9-a6a4-4dff-a8bf-8f8df83dace6', lead_id: leadId, source: 'Synthetic source.csv',
      observed_at: '2026-11-05T09:00:00Z', source_as_of: null, match_method: 'vendor_file',
      snapshot: { renewals: [{ type: 'General Liability', date: '2027-01-22', evidence_class: 'predicted', precision: 'month' }] },
    }],
  };
  let fail = false;
  let failRead = false, savedRequest = '';
  await page.route('**/api/intelligence/dossier?**', (route) => {
    if (failRead) {
      failRead = false;
      return route.fulfill({ status: 503, json: { message: 'Saved dossier view is temporarily unavailable.' } });
    }
    return route.fulfill({ json: dossier });
  });
  await page.route('**/api/intelligence/dossier', async (route) => {
    const body = route.request().postDataJSON();
    if (!fail && savedRequest) {
      expect(body.request_id).toBe(savedRequest);
      expect(body.expected_version).toBe(0);
      return route.fulfill({ json: { version: 1, already_saved: true } });
    }
    expect(body.expected_version).toBe(fail ? 1 : dossier.version);
    expect(body.reference).toBe('Synthetic discovery call; stated by prospect.');
    if (fail) return route.fulfill({ status: 409, json: { message: 'Dossier findings changed. Reload before saving.' } });
    dossier = {
      ...dossier, version: dossier.version + 1, findings: body.findings,
      confirmations: [{ id: body.request_id, scope_key: dossier.scope_key, version: 1, actor_id: 'QA',
        observed_at: '2026-11-05T10:00:00Z', source_as_of: body.source_as_of, reference: body.reference, findings: body.findings }],
      history_total: 1,
    };
    dossier.current_confirmation = dossier.confirmations[0];
    savedRequest = body.request_id; failRead = true;
    return route.fulfill({ json: { version: dossier.version, already_saved: false } });
  });
  let callPrepRequest: Record<string, unknown> | null = null;
  await page.route('**/api/leads/*/draft-outreach', async (route) => {
    callPrepRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      points: ['Ask whether the recorded priority remains accurate.', 'Confirm coverage timing.', 'Agree on a next step.'],
      cited_signals: ['Agent-confirmed dossier finding: stated priorities'],
      dossier_requested: true,
      dossier_facts_included: ['Prospect-stated priorities'],
    } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const callPrep = page.getByText('Call Prep', { exact: true }).locator('..').locator('..');
  await callPrep.getByRole('checkbox', { name: 'Include current confirmed dossier findings in this call prep only' }).check();
  await callPrep.getByRole('button', { name: 'Generate talking points' }).click();
  await expect.poll(() => callPrepRequest).toMatchObject({ mode: 'talking_points', include_dossier: true });
  await expect(callPrep.getByRole('status')).toContainText('Dossier findings included: Prospect-stated priorities');
  await expect(callPrep).toContainText('Grounded in: Agent-confirmed dossier finding: stated priorities');
  const panel = page.getByRole('region', { name: 'Business intelligence' });
  await panel.getByText('Confirm findings', { exact: true }).click();
  await panel.getByLabel('Verified decision-maker and buying authority').fill('Synthetic CFO; buying authority confirmed');
  await panel.getByLabel('Confirmed renewal line').fill('General Liability');
  await panel.getByLabel('Confirmed renewal date').fill('2027-04-22');
  await panel.getByLabel('Evidence reference', { exact: false }).fill('Synthetic discovery call; stated by prospect.');
  await panel.getByLabel('Evidence confirmed on (UTC)').fill('2026-11-05');
  await panel.getByRole('button', { name: 'Save confirmed findings' }).click();
  await expect(panel.getByRole('alert')).toContainText('Saved dossier view is temporarily unavailable');
  await expect(panel.getByLabel('Verified decision-maker and buying authority')).toHaveValue('Synthetic CFO; buying authority confirmed');
  await panel.getByRole('button', { name: 'Save confirmed findings' }).click();
  await expect(panel.getByRole('status')).toContainText('Findings confirmed');
  await page.reload();
  await page.getByRole('button', { name: /Leo Example/ }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(panel).toContainText('Synthetic CFO; buying authority confirmed');
  await panel.getByText('Evidence and confirmation history', { exact: true }).click();
  await expect(panel).toContainText('Predicted month: 2027-01');
  await expect(panel).toContainText('source reporting date unknown');
  await panel.getByText('Internal opportunity briefing', { exact: true }).click();
  await expect(panel).toContainText('Current agency appetite and appointment/access verification');
  await panel.getByText('Confirm findings', { exact: true }).click();
  await panel.getByLabel('Agreed next step').fill('Retain this unfinished edit');
  await panel.getByLabel('Evidence reference', { exact: false }).fill('Synthetic discovery call; stated by prospect.');
  await panel.getByLabel('Evidence confirmed on (UTC)').fill('2026-11-05');
  fail = true;
  dossier = {
    ...dossier,
    version: 2,
    current_confirmation: dossier.current_confirmation
      ? { ...dossier.current_confirmation, version: 2 }
      : null,
  };
  await panel.getByRole('button', { name: 'Next history' }).click();
  await expect(panel).toContainText('findings revision 2');
  await expect(panel.getByLabel('Agreed next step')).toHaveValue('Retain this unfinished edit');
  await panel.getByRole('button', { name: 'Save confirmed findings' }).click();
  await expect(panel.getByRole('alert')).toContainText('Dossier findings changed');
  await expect(panel.getByLabel('Agreed next step')).toHaveValue('Retain this unfinished edit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('real linked dossier saves once, rejects stale scope/version and preserves source history without outreach', async ({ context, authCookies }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) throw new Error('Supabase QA configuration is required.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createServerClient(url, anon, { cookies: { getAll: () => authCookies, setAll: () => {} } });
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user || user.user_metadata.crm_browser_qa !== true) throw new Error('Disposable QA identity is required.');
  const actor = user.id, lead = randomUUID(), account = randomUUID(), request = randomUUID();
  const findings = { ...EMPTY_DOSSIER_FINDINGS, decision_maker: 'Synthetic CFO, buying authority confirmed', next_step: 'Review synthetic documents' };
  try {
    const member = await admin.from('agency_members').insert({ user_id: actor, email: user.email, role: 'agent', active: true });
    if (member.error) throw new Error('Synthetic dossier QA membership could not be created.');
    const createdAccount = await admin.from('clients').insert({ id: account, full_name: 'Synthetic dossier account', agent_user_id: actor });
    const createdLead = await admin.from('leads').insert({ id: lead, full_name: 'Synthetic dossier lead', source: 'intelligence_browser_qa', status: 'new', agent_user_id: actor });
    if (createdAccount.error || createdLead.error) throw new Error('Synthetic dossier QA records could not be created.');
    const read = () => context.request.get(`/api/intelligence/dossier?type=lead&id=${lead}`);
    const initial = await read();
    expect(initial.status()).toBe(200);
    const input = { type: 'lead', id: lead, scope_key: `lead:${lead}`, expected_version: 0, request_id: request,
      findings, reference: 'Synthetic first-party QA statement', source_as_of: new Date().toISOString().slice(0, 10) };
    const save = () => context.request.post('/api/intelligence/dossier', { data: input });
    expect((await save()).status()).toBe(200);
    expect(await (await save()).json()).toMatchObject({ version: 1, already_saved: true });
    const stale = await context.request.post('/api/intelligence/dossier', { data: { ...input, request_id: randomUUID() } });
    expect(stale.status()).toBe(409);
    const snapshot: IntelligenceDossier = await (await read()).json();
    expect(snapshot).toMatchObject({ version: 1, findings });
    expect(snapshot.confirmations).toHaveLength(1);
    const history = await admin.rpc('record_intelligence_enrichment', { p_lead: lead, p_actor: actor, p_source: 'fmcsa',
      p_record: { dot_number: '123', power_units: 12, fetched_at: new Date().toISOString() },
      p_expected: { full_name: 'Synthetic dossier lead', address: null }, p_match_method: 'agent_selected_dot' });
    if (history.error) throw new Error('Synthetic source observation could not be saved.');
    const linked = await admin.from('leads').update({ account_id: account }).eq('id', lead);
    if (linked.error) throw new Error('Synthetic dossier QA account link failed.');
    const canonical: IntelligenceDossier = await (await read()).json();
    expect(canonical.scope_key).toBe(`client:${account}`);
    expect(canonical.confirmations).toHaveLength(1);
    expect(canonical.observations).toHaveLength(1);
    expect((await context.request.post('/api/intelligence/dossier', { data: { ...input, expected_version: 1, request_id: randomUUID() } })).status()).toBe(409);
    expect((await context.request.post('/api/intelligence/dossier', { data: { ...input, scope_key: canonical.scope_key, request_id: randomUUID() } })).status()).toBe(200);
    const accountDossier = await context.request.get(`/api/intelligence/dossier?type=client&id=${account}`);
    expect(await accountDossier.json()).toMatchObject({ version: 1, findings });
    for (const table of ['sequence_enrollments', 'outreach_outbox']) {
      const result = await admin.from(table).select('id').eq('lead_id', lead);
      if (result.error) throw new Error('Dossier no-send verification failed.');
      expect(result.data).toHaveLength(0);
    }
  } finally {
    const results = [
      await admin.from('leads').delete().eq('id', lead),
      await admin.from('clients').delete().eq('id', account),
      await admin.from('agency_audit').delete().eq('actor_id', actor),
      await admin.from('agency_members').delete().eq('user_id', actor),
    ];
    if (results.some((result) => result.error)) throw new Error('Synthetic dossier QA cleanup failed.');
  }
});
