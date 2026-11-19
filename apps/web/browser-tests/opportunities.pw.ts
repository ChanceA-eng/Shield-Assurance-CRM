import { test, expect, leadId } from './workspace-fixtures';
import { EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, type IntelligenceDossier, type OpportunityProfile, type OpportunityDraft } from '@crm/shared';
import { evaluateOpportunity } from '../src/lib/opportunity-matching';
const id = leadId, actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const day = new Date().toISOString().slice(0, 10);
const makeDossier = (): IntelligenceDossier => ({ scope_key: `lead:${id}`, record_name: 'Synthetic OIP Business', version: 0,
  findings: { ...EMPTY_DOSSIER_FINDINGS }, observations: [], confirmations: [], observations_total: 0, history_total: 0, page: 0 });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/intelligence/operations**', (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has('id')
    ? { watch: null, outcomes: [], evidence: [], relationships: [], held_lines: [], documents: [], requests: [] }
    : { watches: [], digests: [], searches: [], outcomes: [], scheduler: { active: false, configured: true, last_job_at: null } } }));
});
function setup() {
  let profile: OpportunityProfile = { ...EMPTY_OPPORTUNITY_PROFILE, facts: {} };
  let revision = 0, token = 'initial-evidence', draft: OpportunityDraft | null = null;
  const requests: Array<Record<string, unknown>> = [];
  let lostSave = false, rejectStaleSend = false;
  const workspace = () => ({ target: { type: 'lead', id }, record_name: 'Synthetic OIP Business',
    profile: { scope_key: `lead:${id}`, revision, profile }, assessment: evaluateOpportunity(profile, [], makeDossier(), day),
    evidence_token: token, evaluated_on: day, draft, agents: [{ user_id: actor, email: 'synthetic-agent@example.test' }] });
  return {
    requests, workspace,
    setLostSave: () => { lostSave = true; },
    stale: () => { token = 'changed-carrier-revision'; },
    blockSend: () => { rejectStaleSend = true; },
    preset: () => { profile = { ...EMPTY_OPPORTUNITY_PROFILE, facts: { state: 'AZ', line: 'General liability', industry: 'Restaurant' },
      source_reference: 'Synthetic authorized call and email permission', confirmed_on: day, contactability: 'verified_email', permission: 'permitted' }; revision = 1; },
    handle: async (route: import('@playwright/test').Route) => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET') {
        await route.fulfill({ json: url.searchParams.has('id') ? workspace() : { items: revision ? [workspace()] : [], has_more: false, page: 0 } }); return;
      }
      const input = request.postDataJSON(); requests.push(input);
      if (url.pathname.endsWith('/send')) {
        if (rejectStaleSend) { await route.fulfill({ status: 409, json: { message: 'Evidence changed or expired. Rebuild and review the draft before sending.' } }); return; }
        if (!draft || draft.state !== 'approved' || draft.evidence_token !== token) { await route.fulfill({ status: 409, json: { message: 'Draft not approved or stale.' } }); return; }
        draft = { ...draft, state: 'sent' };
        await route.fulfill({ status: 201, json: { delivery: 'accepted_by_provider' } }); return;
      }
      if (input.action === 'profile') { profile = input.profile; revision++; token = `profile-${revision}`; await route.fulfill({ json: {} }); return; }
      if (input.action === 'prepare' || input.action === 'prepare_ai') { await route.fulfill({ json: { subject: 'Business insurance review',
        body: 'Would a brief review of your general liability needs be useful?', cited_signals: input.action === 'prepare_ai' ? ['Confirmed required coverage line'] : [] } }); return; }
      if (input.action === 'task') { await route.fulfill({ json: { id: input.task_id, action_href: `/leads/opportunities?type=lead&id=${id}` } }); return; }
      if (input.action === 'save_draft') {
        if (!draft || draft.revision === input.revision) {
          draft = { id: input.draft_id, scope_key: `lead:${id}`, revision: input.revision + 1, subject: input.subject, body: input.body,
            state: 'draft', request_id: actor, evidence_token: token };
        }
        if (lostSave) { lostSave = false; await route.fulfill({ status: 503, json: { message: 'Save response lost. Retry unchanged draft.' } }); return; }
      } else if (input.action === 'approve' && draft) {
        draft = { ...draft, state: 'approved' };
      }
      await route.fulfill({ json: draft });
    },
  };
}
test('reviewed business facts persist and create a scored opportunity without authoring carrier rules', async ({ page }) => {
  const mock = setup();
  await page.route('**/api/intelligence/opportunities**', mock.handle);
  await page.goto(`/leads/opportunities?type=lead&id=${id}`);
  await expect(page).toHaveURL(`/leads?lead=${id}&tab=overview&intelligence=1`);
  await page.getByText('Reviewed business matching facts · revision 0', { exact: true }).click();
  await page.getByLabel('Business state', { exact: true }).fill('AZ');
  await page.getByLabel('Business line', { exact: true }).fill('General liability');
  await page.getByLabel('Business industry', { exact: true }).fill('Restaurant');
  await page.getByLabel('Business evidence reference').fill('Synthetic verified prospect call and permitted email follow-up');
  await page.getByLabel('Business facts confirmed on').fill(day);
  await page.getByLabel('Contact permission', { exact: true }).selectOption('permitted');
  await page.getByLabel('Verified contact route', { exact: true }).selectOption('verified_email');
  await page.getByRole('button', { name: 'Save reviewed business facts' }).click();
  await expect(page.getByRole('region', { name: 'Market fit and actions' }).getByRole('status')).toContainText('Business facts saved');
  await page.reload();
  await expect(page.getByText('Reviewed business matching facts · revision 1')).toBeVisible();
  await expect(page.getByText(/needs review · priority 30/)).toBeVisible();
  expect(mock.requests.filter((request) => request.action === 'profile')).toHaveLength(1);
  expect(mock.requests.some((request) => request.action === 'activate' || request.action === 'send')).toBe(false);
  await page.goto('/leads?view=queue&reviews=1');
  await expect(page.getByRole('heading', { name: /Synthetic OIP Business/ })).toBeVisible();
});
test('briefing creates a linked review task and draft retries retain exact IDs; nothing sends without approval', async ({ page }) => {
  const mock = setup(); mock.preset(); mock.setLostSave();
  await page.route('**/api/intelligence/opportunities**', mock.handle);
  await page.goto(`/leads/opportunities?type=lead&id=${id}`);
  await page.getByLabel('Opportunity task due').fill(`${day}T15:00`);
  await page.getByRole('button', { name: 'Create review task' }).click();
  await expect(page.getByRole('region', { name: 'Market fit and actions' }).getByRole('status')).toContainText('Review task created');
  const task = mock.requests.find((request) => request.action === 'task');
  expect(task?.assignee).toBe(actor); expect(String(task?.due_at)).toMatch(/Z$/);
  await page.getByText('Draft an individual follow-up', { exact: true }).click();
  await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare permission-first draft' }).click();
  await page.getByRole('button', { name: 'Close Draft with AI' }).click();
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Save response lost' })).toBeVisible();
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await expect(page.getByRole('region', { name: 'Market fit and actions' }).getByRole('status')).toContainText('Draft saved');
  const saves = mock.requests.filter((request) => request.action === 'save_draft');
  expect(saves).toHaveLength(2); expect(saves[0].draft_id).toBe(saves[1].draft_id);
  await expect(page.getByRole('button', { name: 'Approve exact draft' })).toBeDisabled();
  expect(mock.requests.some((request) => !request.action)).toBe(false);
});
test('exact approval permits one explicit mocked send and editing or changed evidence blocks approval', async ({ page }) => {
  const mock = setup(); mock.preset();
  await page.route('**/api/intelligence/opportunities**', mock.handle);
  await page.goto(`/leads/opportunities?type=lead&id=${id}`);
  await page.getByText('Draft an individual follow-up', { exact: true }).click();
  await page.getByLabel('Message subject').fill('Business review');
  await page.getByLabel('Message body').fill('Would a short business needs review be useful?');
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await page.getByRole('checkbox', { name: /I reviewed the exact text/ }).check();
  await page.getByRole('button', { name: 'Approve exact draft' }).click();
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeEnabled();
  await page.getByLabel('Message body').fill('Changed unreviewed content');
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I reviewed the exact text/ }).check();
  await page.getByRole('button', { name: 'Approve exact draft' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Send reviewed email' }).click();
  await expect(page.getByText('Delivery state: sent.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
  expect(mock.requests.filter((request) => !request.action)).toHaveLength(1);
  await page.getByRole('button', { name: 'Start a separate follow-up' }).click();
  await expect(page.getByLabel('Message body')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
  mock.stale();
  await page.reload();
  await page.getByText('Draft an individual follow-up', { exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Evidence changed or expired' })).toBeVisible();
});
test('AI is explicit opt-in and does not send; stale final evidence prevents dispatch', async ({ page }) => {
  const mock = setup(); mock.preset(); mock.blockSend();
  await page.route('**/api/intelligence/opportunities**', mock.handle);
  await page.goto(`/leads/opportunities?type=lead&id=${id}`);
  await page.getByText('Draft an individual follow-up', { exact: true }).click();
  await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draft grounded follow-up with AI' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Use the business name/ }).check();
  await page.getByRole('button', { name: 'Draft grounded follow-up with AI' }).click();
  await page.getByRole('button', { name: 'Close Draft with AI' }).click();
  expect(mock.requests.find((request) => request.action === 'prepare_ai')?.ai_confirmed).toBe(true);
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await page.getByRole('checkbox', { name: /I reviewed the exact text/ }).check();
  await page.getByRole('button', { name: 'Approve exact draft' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Send reviewed email' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Evidence changed or expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reviewed email' })).toBeDisabled();
});

test('existing lead and account overviews open actions inline without an extra navigation destination', async ({ page, data }) => {
  const mock = setup(); mock.preset();
  let reads = 0;
  await page.route('**/api/intelligence/opportunities**', async (route) => {
    reads++;
    await route.fulfill({ json: mock.workspace() });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/leads?lead=${id}`);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Business intelligence' })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByText('Market fit and next actions', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Market fit and actions' })).toBeVisible();
  await expect(page.getByLabel('Business state', { exact: true })).not.toBeVisible();
  await page.getByText('Draft an individual follow-up', { exact: true }).click();
  const composer = page.getByRole('region', { name: 'Market fit and actions' });
  await composer.getByLabel('Message body').fill('Keep this unfinished business follow-up');
  await page.getByText('Market fit and next actions', { exact: true }).click();
  await page.getByText('Market fit and next actions', { exact: true }).click();
  await expect(composer.getByLabel('Message body')).toHaveValue('Keep this unfinished business follow-up');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`/leads/opportunities?type=client&id=${data.account.id}`);
  await expect(page).toHaveURL(`/clients/${data.account.id}?tab=overview&intelligence=1`);
  await expect(page.getByRole('region', { name: 'Market fit and actions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Opportunity Intelligence', exact: true })).toHaveCount(0);
});

test('old queue links open Work Queue and invalid business links report the problem', async ({ page }) => {
  const mock = setup();
  await page.route('**/api/intelligence/opportunities**', mock.handle);
  await page.goto('/leads/opportunities');
  await expect(page).toHaveURL('/leads?view=queue&reviews=1');
  await expect(page.getByText('Business reviews and next actions', { exact: true })).toBeVisible();
  await page.goto('/leads/opportunities?type=lead&id=invalid');
  await expect(page.getByRole('alert').filter({ hasText: 'business link is invalid' })).toBeVisible();
});
