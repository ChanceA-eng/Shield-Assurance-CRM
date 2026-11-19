import { test, expect, leadId } from './workspace-fixtures';
import { prospectingSchedule } from '../src/lib/prospecting-schedule';
import { prospectingReadiness } from '../src/lib/prospecting-evidence';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

test('deployed contact preferences and prospecting APIs read the installed schema', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase QA configuration required.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID();
  const email = `prospecting-${id}@example.invalid`;
  const created = await db.from('leads').insert({ id, full_name: 'Synthetic prospecting API QA', email, status: 'new', source: 'browser_qa' });
  if (created.error) throw new Error('Could not create the disposable prospecting API record.');
  try {
    const preference = await context.request.get(`/api/record-contact-preference?type=lead&id=${id}`);
    expect(preference.status()).toBe(200);
    expect(await preference.json()).toMatchObject({ do_not_contact: false, inherited: false });
    const plan = await context.request.get(`/api/leads/${id}/prospecting-cadence`);
    expect(plan.status()).toBe(200);
    expect(await plan.json()).toMatchObject({ cadence: null, can_manage: false });
  } finally {
    const removed = await db.from('leads').delete().eq('id', id).eq('email', email);
    if (removed.error) throw new Error('Could not remove the disposable prospecting API record.');
  }
});

test('optional plan persists on reload and logs calls without sending email', async ({ page, data }) => {
  const mutations: Array<Record<string, unknown>> = [];
  let plan: {
    id: string; status: string; ended_reason: string | null; voicemail_count: number; context: { priority: string };
    touches: Array<{
      id: string; touch_number: number; channel: string; due_at: string; status: string;
      outcome: string | null; voicemail: boolean; email_status: string | null; email_error: string | null;
    }>;
  } | null = null;
  await page.route(`**/api/leads/${leadId}/prospecting-cadence`, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push(body);
      if (request.method() === 'POST') {
        plan = {
          id: 'synthetic-plan', status: 'active', ended_reason: null, voicemail_count: 0, context: { priority: String(body.priority) },
          touches: prospectingSchedule(new Date(Date.now() - 86400000)).map((touch) => ({
            ...touch, id: `touch-${touch.touch_number}`, status: 'planned', outcome: null,
            voicemail: false, email_status: null, email_error: null,
          })),
        };
      } else if (plan && body.action === 'cancel') {
        plan.status = 'cancelled';
        plan.ended_reason = 'Cancelled by the agent.';
        plan.touches.forEach((touch) => { if (touch.status === 'planned') touch.status = 'cancelled'; });
      } else if (plan && body.action === 'log_call') {
        const touch = plan.touches.find((touch) => touch.id === body.touch_id);
        if (touch) {
          touch.status = 'completed';
          touch.outcome = String(body.outcome);
          if (body.outcome === 'voicemail') { touch.voicemail = true; plan.voicemail_count++; }
        }
      }
    }
    await route.fulfill({ json: { cadence: plan, can_manage: true, can_cancel: true, readiness: prospectingReadiness(null, []) } });
  });
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Do not contact' })).toHaveCount(0);
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '21-day prospecting plan' }) });
  await expect(panel.getByText('contact-only prospect details', { exact: true })).toBeVisible();
  await panel.getByLabel('Prospecting priority').selectOption('B');
  await panel.getByRole('button', { name: 'Start 21-day plan', exact: true }).click();
  await expect(panel.getByText('Plan active', { exact: true })).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(8);
  await panel.getByLabel('Outcome for call touch 1').selectOption('voicemail');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('Voicemails: 1/2')).toBeVisible();
  await expect(panel.getByLabel('Prospecting priority')).toHaveValue('B');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByText('Voicemails: 1/2')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: 'Cancel plan', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel plan', exact: true }).click();
  await expect(panel.getByText('Plan cancelled', { exact: true })).toBeVisible();
  expect(mutations).toEqual([{ confirm: true, priority: 'B' }, { action: 'log_call', touch_id: 'touch-1', outcome: 'voicemail' }, { action: 'cancel' }]);
  expect(data.requests.some((request) => request.includes('/outbox/') || request.includes('draft-outreach') || request.includes('/outreach/run'))).toBe(false);
});

test('existing contact restrictions remain visible and can be cleared without a do-not-contact toggle', async ({ page, data }) => {
  data.doNotContact = true;
  await page.goto(`/leads?lead=${leadId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('checkbox', { name: 'Do not contact' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start 21-day plan', exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Contact is restricted\. Review the contact/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear restriction' }).click();
  await expect(page.getByRole('button', { name: 'Start 21-day plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear restriction' })).toHaveCount(0);
  expect(data.doNotContact).toBe(false);
});
