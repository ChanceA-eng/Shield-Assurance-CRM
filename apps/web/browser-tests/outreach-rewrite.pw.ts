import { test, expect, leadId } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const id = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
test.beforeEach(async ({ data }) => {
  data.outreachPending.push({
    id, lead_id: leadId, lead_name: 'Leo Example', step_number: 1, to_email: 'leo@example.invalid',
    subject: 'Original subject', body: 'Original draft for review', cited_signals: ['Commercial auto'],
    draft_revision: 0, created_at: new Date().toISOString(),
  });
});

test('rewrites current edits with instructions, persists on reload and never sends', async ({ page, data }) => {
  await page.goto('/outreach', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Draft body for Leo Example' }).fill('My edited draft');
  await page.getByRole('button', { name: 'Rewrite with AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate rewrite', exact: true })).toBeDisabled();
  await page.getByLabel('Rewrite instructions', { exact: true }).fill('Make it warmer and ask for the VIN by email.');
  await page.getByRole('button', { name: 'Generate rewrite', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Nothing was sent');
  await expect(page.getByRole('textbox', { name: 'Draft subject for Leo Example' })).toHaveValue('Your commercial auto next step');
  expect(data.rewriteBodies).toEqual([expect.objectContaining({ instruction: 'Make it warmer and ask for the VIN by email.', body: 'My edited draft', revision: 0 })]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Draft subject for Leo Example' })).toHaveValue('Your commercial auto next step');
  await expect(page.getByRole('button', { name: 'Approve and send', exact: true })).toBeEnabled();
  expect(data.requests.filter((request) => request.includes('/outbox/'))).toEqual([`POST /api/outreach/outbox/${id}/rewrite`]);
});

test('mobile rewrite failure retains original edits and instructions for retry', async ({ page, data }) => {
  data.failRewrite = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/outreach', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Rewrite with AI', exact: true }).click();
  await page.getByLabel('Rewrite instructions', { exact: true }).fill('Keep it concise.');
  await page.getByRole('button', { name: 'Generate rewrite', exact: true }).click();
  await expect(page.getByText('AI rewriting is unavailable. Your original draft was not changed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Draft subject for Leo Example' })).toHaveValue('Original subject');
  await expect(page.getByLabel('Rewrite instructions', { exact: true })).toHaveValue('Keep it concise.');
  expect(data.outreachPending[0].draft_revision).toBe(0);
  data.failRewrite = false;
  await page.getByRole('button', { name: 'Generate rewrite', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Nothing was sent');
});

test('real authenticated rewrite persists a synthetic draft without sending and rejects stale revisions', async ({ context }) => {
  test.skip(process.env.CRM_BROWSER_AI_QA_ALLOWED !== '1', 'Explicit opt-in is required for a real AI provider request.');
  test.setTimeout(90000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for rewrite persistence verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const syntheticLead = randomUUID();
  const outboxId = randomUUID();
  try {
    const lead = await admin.from('leads').insert({
      id: syntheticLead, full_name: 'Synthetic QA prospect', email: 'rewrite-qa@example.invalid',
      status: 'new', source: 'synthetic_qa', line_of_business: 'Commercial auto',
      form_payload: { profile: { kind: 'generic' } },
    });
    if (lead.error) throw new Error(lead.error.message);
    const draft = await admin.from('outreach_outbox').insert({
      id: outboxId, lead_id: syntheticLead, step_number: 1, to_email: 'rewrite-qa@example.invalid',
      subject: 'Your commercial auto request',
      body: 'Hello, I am following up about your commercial auto request. Could you reply by email with the renewal month you would like us to review? This will help us understand the timing of your request without assuming anything about your current insurance. We can keep the next step over email and discuss any further information once you are ready.',
      cited_signals: ['Line of business: Commercial auto'],
    });
    if (draft.error) throw new Error(draft.error.message);
    const response = await context.request.post(`/api/outreach/outbox/${outboxId}/rewrite`, { data: {
      revision: 0, instruction: 'Make this warmer and direct, 60-80 words. Ask only for the renewal month by email; do not invent facts or appointments. Keep the supplied signature.',
      subject: 'Your commercial auto request', body: 'Please reply with the renewal month for the commercial auto review.',
    } });
    expect(response.status(), await response.text()).toBe(200);
    const result = await response.json() as { subject: string; body: string; cited_signals: string[]; draft_revision: number };
    expect(result.draft_revision).toBe(1);
    expect(result.body.toLowerCase()).toContain('renewal');
    const saved = await admin.from('outreach_outbox').select('subject,body,cited_signals,draft_revision,status,sent_at,requires_manual_approval').eq('id', outboxId).single();
    if (saved.error) throw new Error(saved.error.message);
    expect(saved.data).toEqual({ ...result, status: 'pending_approval', sent_at: null, requires_manual_approval: true });
    const stale = await context.request.post(`/api/outreach/outbox/${outboxId}/rewrite`, { data: {
      revision: 0, instruction: 'Shorten this', subject: result.subject, body: result.body,
    } });
    expect(stale.status()).toBe(409);
    const logs = await admin.from('communication_log').select('id').contains('metadata', { outbox_id: outboxId });
    if (logs.error) throw new Error(logs.error.message);
    expect(logs.data).toEqual([]);
  } finally {
    const draft = await admin.from('outreach_outbox').delete().eq('id', outboxId);
    const taskIds = await admin.from('tasks').select('id').eq('related_type', 'lead').eq('related_id', syntheticLead);
    if (taskIds.error) throw new Error(taskIds.error.message);
    const notifications = taskIds.data.length ? await admin.from('notifications').delete().in('task_id', taskIds.data.map((task) => task.id)) : { error: null };
    const tasks = await admin.from('tasks').delete().eq('related_type', 'lead').eq('related_id', syntheticLead);
    const lead = await admin.from('leads').delete().eq('id', syntheticLead);
    const failures = [draft.error, notifications.error, tasks.error, lead.error].filter(Boolean);
    if (failures.length) throw new Error(`Rewrite QA cleanup failed: ${failures.map((error) => error?.message).join('; ')}`);
  }
});
