import { test, expect, leadId } from './workspace-fixtures';
import type { QuestionnaireTemplate } from '../src/lib/prospect-questionnaires';

const questionId = 'c3db2f75-a682-4d14-8c76-693b4f123456';
const templateId = 'a3db2f75-a682-4d14-8c76-693b4f123456';
const design = { name: 'Shared prospect request', questions: [
  { id: questionId, label: 'Full name', type: 'text' as const, required: true, options: [], field: 'full_name' as const },
] };
test('customizing a shared questionnaire issues a tailored link and sends only on explicit invitation', async ({ page }) => {
  const rows: QuestionnaireTemplate[] = [{ id: templateId, owner_id: null, revision: 1, source_id: null, ...design }];
  const saves: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  const invitations: Array<Record<string, unknown>> = [];
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { connection: null } }));
  await page.route('**/api/questionnaires**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') return route.fulfill({ json: url.searchParams.get('action') === 'templates' ? rows : [] });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'save_template') {
      saves.push(body);
      const saved = { id: String(body.id), owner_id: 'synthetic-agent', revision: 1, source_id: templateId,
        ...body.design as typeof design };
      rows.push(saved);
      return route.fulfill({ json: saved });
    }
    if (body.action === 'invitation') {
      invitations.push(body);
      return route.fulfill({ json: { delivery: 'accepted_by_provider', provider: 'resend' } });
    }
    requests.push(body);
    return route.fulfill({ json: { request: { id: templateId, expires_at: new Date(Date.now() + 1800000).toISOString() }, path: `/secure-intake/${'a'.repeat(43)}` } });
  });
  await page.goto('/leads?intake=1');
  await expect(page.getByRole('dialog', { name: 'Intake requests', exact: true })).toBeVisible();
  await page.getByRole('button', { name: design.name, exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('My auto questions');
  await page.getByLabel('Question 1', { exact: true }).fill('Driver full name');
  await page.getByRole('button', { name: 'Save my template', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your template was saved.');
  expect(saves[0].id).not.toBe(templateId);
  expect(saves[0].source_id).toBe(templateId);
  expect(rows[0].name).toBe('Shared prospect request');
  await page.getByLabel('Question 1', { exact: true }).fill('Name for this request only');
  await page.getByLabel('Recipient name', { exact: true }).fill('Synthetic prospect');
  await page.getByLabel('Recipient email', { exact: true }).fill('synthetic@example.invalid');
  await expect(page.getByLabel('Expires', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate link', exact: true }).click();
  await expect(page.getByLabel('New request link', { exact: true })).toHaveValue(new RegExp(`/secure-intake/${'a'.repeat(43)}$`));
  expect(saves).toHaveLength(1);
  expect(requests[0]).toMatchObject({ design: { questions: [{ label: 'Name for this request only' }] } });
  expect(requests[0]).not.toHaveProperty('expires_at');
  expect(rows[1].questions[0].label).toBe('Driver full name');
  await expect(page.getByRole('link', { name: 'Open email app', exact: true })).toHaveAttribute('href', /^mailto:/);
  expect(invitations).toHaveLength(0);
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Invitation sent.');
  await expect(page.getByRole('button', { name: 'Invitation sent', exact: true })).toBeDisabled();
  expect(invitations).toEqual([expect.objectContaining({ action: 'invitation', id: templateId, token: 'a'.repeat(43), email_provider: 'default' })]);
});

test('record prefill and regenerated links preserve the intended recipient without overwriting another request draft', async ({ page }) => {
  const targetId = leadId;
  const row = { id: templateId, recipient: 'saved@example.invalid', recipient_name: 'Saved prospect', state: 'submitted',
    expires_at: '2099-01-01', target_type: 'lead', target_id: targetId, can_reopen: true,
    current_values: {}, files: [], submissions: [] };
  const operations: Array<Record<string, unknown>> = [];
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { connection: null } }));
  await page.route('**/api/questionnaires**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'templates') return route.fulfill({ json: [{ id: templateId, owner_id: null, revision: 1, source_id: null, ...design }] });
      if (action === 'context') {
        expect(url.searchParams.get('target_id')).toBe(targetId);
        return route.fulfill({ json: { name: 'Saved prospect', email: 'saved@example.invalid' } });
      }
      return route.fulfill({ json: [row] });
    }
    operations.push(route.request().postDataJSON() as Record<string, unknown>);
    row.state = 'open';
    return route.fulfill({ json: { request: { expires_at: new Date(Date.now() + 1800000).toISOString() }, path: `/secure-intake/${'c'.repeat(43)}` } });
  });
  await page.goto(`/leads?lead=${targetId}&intake=1`);
  await page.getByText('Saved prospect · submitted', { exact: true }).click();
  await expect(page.getByLabel('New expiration', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen as new revision', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open email app', exact: true })).toHaveAttribute('href', /^mailto:saved%40example.invalid\?/);
  await page.getByRole('button', { name: design.name, exact: true }).click();
  await expect(page.getByLabel('Recipient name', { exact: true })).toHaveValue('Saved prospect');
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('saved@example.invalid');
  await page.getByLabel('Recipient name', { exact: true }).fill('Different draft');
  await page.getByLabel('Recipient email', { exact: true }).fill('draft@example.invalid');
  await page.getByRole('button', { name: 'Replace open link', exact: true }).click();
  await expect(page.getByLabel('New request link', { exact: true })).toHaveValue(new RegExp(`/secure-intake/${'c'.repeat(43)}$`));
  await expect(page.getByLabel('Recipient name', { exact: true })).toHaveValue('Different draft');
  await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('draft@example.invalid');
  await expect(page.getByRole('link', { name: 'Open email app', exact: true })).toHaveAttribute('href', /^mailto:saved%40example.invalid\?/);
  expect(operations.map((operation) => operation.action)).toEqual(['reopen', 'rotate']);
  expect(operations.every((operation) => !('expires_at' in operation))).toBe(true);
});

test('mobile prospect verifies email, uploads a photo and submits without seeing the CRM shell', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const token = 'b'.repeat(43), fileId = 'd3db2f75-a682-4d14-8c76-693b4f123456';
  const files: Array<{ id: string; name: string; question_id: string; state: string }> = [];
  const publicDesign = { ...design, questions: [...design.questions, { id: fileId, label: 'Driver ID', type: 'file', required: true, field: '', options: [] }] };
  let verified = false, submitted = false;
  const answers: unknown[] = [];
  await page.route('**/api/questionnaire-upload-test', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route(`**/api/questionnaire/${token}`, async (route) => {
    const body = route.request().method() === 'GET' ? { action: 'form' } : route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'challenge') return route.fulfill({ json: { message: 'Check the recipient email for your code.' } });
    if (body.action === 'verify') { verified = true; return route.fulfill({ json: { verified: true } }); }
    if (!verified) return route.fulfill({ status: 401, json: { message: 'Verify email.' } });
    if (body.action === 'upload') {
      files.push({ id: fileId, name: 'synthetic-id.png', question_id: fileId, state: 'pending' });
      return route.fulfill({ json: { id: fileId, signed_url: new URL('/api/questionnaire-upload-test', route.request().url()).href, content_type: 'image/png' } });
    }
    if (body.action === 'submit') { submitted = true; answers.push(body); return route.fulfill({ json: { submitted: true } }); }
    return route.fulfill({ json: submitted ? { submitted: true } : { design: publicDesign, recipient_name: 'Synthetic prospect',
      contact: { first_name: 'Synthetic', last_name: 'Prospect' }, expires_at: new Date(Date.now() + 1800000).toISOString(), files } });
  });
  await page.goto(`/secure-intake/${token}`);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rashi', exact: true })).toHaveCount(0);
  await page.getByLabel('First name', { exact: true }).fill('Synthetic');
  await page.getByLabel('Last name', { exact: true }).fill('Prospect');
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Email me a code', exact: true })).toHaveCount(0);
  await expect(page.getByText(/provider/i)).toHaveCount(0);
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Full name *', { exact: true })).toHaveValue('Synthetic Prospect');
  await expect(page.getByText(/This link expires/)).toHaveCount(0);
  await page.getByLabel('Full name *', { exact: true }).fill('Synthetic driver');
  await expect(page.getByLabel('Take a photo', { exact: true })).toHaveAttribute('capture', 'environment');
  await page.getByLabel('Choose a file', { exact: true }).setInputFiles({ name: 'synthetic-id.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await expect(page.getByText('synthetic-id.png · Checking file', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /I reviewed my answers/ }).check();
  await page.getByRole('button', { name: 'Submit to my agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thank you', exact: true })).toBeVisible();
  expect(answers).toEqual([{ action: 'submit', answers: { [questionId]: 'Synthetic driver' }, consent: true }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('producer review applies only selected fields and does not offer agents a reopen or unsafe download', async ({ page }) => {
  const submissionId = 'e3db2f75-a682-4d14-8c76-693b4f123456';
  const row = { id: templateId, recipient: 'synthetic@example.invalid', recipient_name: 'Synthetic prospect', state: 'submitted',
    expires_at: '2099-01-01', target_type: 'lead', target_id: 'f4a2328d-48d3-4be9-9896-81e69d8ea4f6', can_reopen: false,
    current_values: { full_name: 'Original name', phone: null, address: null, line_of_business: null },
    files: [{ id: questionId, revision: 1, name: 'id-awaiting-check.png', state: 'pending' }],
    submissions: [{ id: submissionId, revision: 1, answers: { [questionId]: 'Submitted name' }, design, state: 'needs_review',
      contact: { first_name: 'Submitted', last_name: 'Name' }, created_at: '2099-01-01T00:00:00Z' }] };
  const reviews: Array<Record<string, unknown>> = [];
  await page.route('**/api/questionnaires**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: new URL(route.request().url()).searchParams.get('action') === 'templates' ? [] : [row] });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    reviews.push(body); row.submissions[0].state = 'accepted';
    return route.fulfill({ json: {} });
  });

  await page.goto('/leads?intake=1');
  await page.getByText('Synthetic prospect · submitted · Needs review', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen as new revision', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
  await expect(page.getByText('Submitted name', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Apply to full name (currently: Original name)', exact: true }).check();
  await page.getByRole('button', { name: 'Accept reviewed answers', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Submission reviewed. Selected fields applied.');
  expect(reviews).toEqual([{ action: 'review', id: templateId, submission_id: submissionId, decision: 'accepted',
    fields: ['full_name'], expected_values: { full_name: 'Original name', phone: null, address: null, line_of_business: null } }]);
});

test('intake opens on the account without navigation and protects edits when closing', async ({ page, data }) => {
  const recipient = 'account-intake@example.invalid';
  data.account.email = recipient;
  await page.route('**/api/policy-change-requests**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/questionnaires**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    return route.fulfill({ json: action === 'templates' ? [{ id: templateId, owner_id: null, revision: 1, source_id: null, ...design }]
      : action === 'context' ? { name: data.account.full_name, email: data.account.email } : [] });
  });
  await page.goto(`/clients/${data.account.id}?tab=policies`);
  const originalUrl = page.url();
  const trigger = page.getByRole('button', { name: 'Intake requests', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Intake requests', exact: true });
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await dialog.getByRole('button', { name: design.name, exact: true }).click();
  await expect(dialog.getByLabel('Recipient email', { exact: true })).toHaveValue(recipient);
  await page.screenshot({ path: test.info().outputPath('account-intake.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-intake-mobile.png'), fullPage: true });
  await dialog.getByLabel('Question 1', { exact: true }).fill('Unfinished intake question');
  page.once('dialog', (warning) => { expect(warning.message()).toMatch(/unsaved changes/i); void warning.dismiss(); });
  await dialog.getByRole('button', { name: 'Close intake requests', exact: true }).click();
  await expect(dialog.getByLabel('Question 1', { exact: true })).toHaveValue('Unfinished intake question');
  page.once('dialog', (warning) => { void warning.accept(); });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(page.url()).toBe(originalUrl);
  await expect(page.locator('a[href="/questionnaires"]')).toHaveCount(0);
});

test('past-deadline prospects see a closed link instead of unusable verification buttons', async ({ page }) => {
  const token = 'e'.repeat(43);
  await page.route(`**/api/questionnaire/${token}`, (route) => route.fulfill({
    status: 410, json: { message: 'This link is closed, expired or unavailable. Ask your agent for help.' },
  }));
  await page.goto(`/secure-intake/${token}`);
  await expect(page.getByRole('heading', { name: 'Link closed', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code', exact: true })).toHaveCount(0);
});

test('a verified customer cannot keep filling an intake after its generation deadline', async ({ page }) => {
  const token = 'f'.repeat(43);
  const expires = Date.now() + 60000;
  await page.clock.install();
  await page.route(`**/api/questionnaire/${token}`, (route) => route.fulfill({ json: {
    design, recipient_name: 'Synthetic prospect', contact: { first_name: 'Synthetic', last_name: 'Prospect' },
    expires_at: new Date(expires).toISOString(), files: [],
  } }));
  await page.goto(`/secure-intake/${token}`);
  await expect(page.getByRole('button', { name: 'Submit to my agent', exact: true })).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(page.getByRole('heading', { name: 'Link closed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit to my agent', exact: true })).toHaveCount(0);
});
