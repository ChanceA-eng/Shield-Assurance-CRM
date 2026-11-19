import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { agencyDateTimeInput } from '../src/lib/agency-time';
import { test, expect, leadId } from './workspace-fixtures';

test('lead composer schedules with agency time, retains failed drafts and cancels without sending', async ({ page }) => {
  let queued = false, fail = true, requestId = '', sends = 0;
  await page.route('**/api/communication-log', async (route) => {
    if (route.request().method() === 'POST') sends++;
    await route.fulfill({ json: [] });
  });
  const future = new Date(Date.now() + 86400000 * 2);
  const date = agencyDateTimeInput(future, 'America/Phoenix');
  await page.route('**/api/leads/*/scheduled-messages', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.body).toBe('Synthetic scheduled email');
      expect(body.send_at).toBe(new Date(`${date}:00-07:00`).toISOString());
      if (requestId) expect(body.request_id).toBe(requestId);
      requestId = body.request_id;
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { message: 'Temporary scheduling failure' } }); }
      queued = true;
      return route.fulfill({ status: 201, json: { id: requestId, status: 'pending', send_at: body.send_at } });
    }
    if (method === 'DELETE') { queued = false; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: queued ? [{ id: requestId, subject: 'Synthetic subject', send_at: future.toISOString(), status: 'pending', last_error: null }] : [] });
  });
  await page.setViewportSize({ width: 489, height: 426 });
  await page.goto(`/leads?lead=${leadId}`);
  const profile = page.getByRole('complementary', { name: 'Lead profile' });
  await profile.getByRole('button', { name: 'Conversation', exact: true }).click();
  await profile.getByPlaceholder('Subject', { exact: true }).fill('Synthetic subject');
  const body = profile.locator('textarea').filter({ hasNot: page.locator('[hidden]') }).first();
  await body.fill('Synthetic scheduled email');
  await profile.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await schedule.getByLabel('Send date and time - America/Phoenix', { exact: true }).fill(date);
  await schedule.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(schedule.getByRole('alert').filter({ hasText: 'Temporary scheduling failure' })).toBeVisible();
  await expect(body).toHaveValue('Synthetic scheduled email');
  await schedule.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(schedule.getByRole('status')).toContainText('Not sent yet');
  await expect(body).toHaveValue('');
  await schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true })).toHaveCount(0);
  expect(sends).toBe(0);
});

test('account composer schedules in agency time and makes unavailable texting explicit', async ({ page, data }) => {
  data.account.email = 'synthetic@example.invalid';
  data.account.email_consent = true;
  let schedules = 0, sends = 0, cancelled = false;
  const date = '2099-01-01T09:00';
  await page.route('**/api/communication/scheduled?**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('conversation')).toBe(`client:${data.account.id}`);
    if (route.request().method() === 'POST') {
      schedules++;
      expect(route.request().postDataJSON()).toMatchObject({
        channel: 'email', body: 'Synthetic account follow up', subject: 'Review', send_at: '2099-01-01T16:00:00.000Z',
      });
      return route.fulfill({ status: 201, json: { status: 'pending' } });
    }
    if (route.request().method() === 'DELETE') { cancelled = true; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: schedules && !cancelled ? [{ id: 'synthetic', status: 'pending', subject: 'Review', send_at: '2099-01-01T16:00:00Z' }] : [] });
  });
  await page.route('**/api/communication-log', async (route) => {
    if (route.request().method() === 'POST') sends++;
    await route.fulfill({ json: [] });
  });
  await page.goto(`/clients/${data.account.id}?tab=communication`);
  const drawer = page.getByRole('complementary', { name: 'Client conversation' });
  const composer = drawer.getByRole('region', { name: 'Message composer' });
  await composer.getByLabel('Message subject').fill('Review');
  await composer.getByLabel('Message body').fill('Synthetic account follow up');
  await composer.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await schedule.getByLabel('Send date and time - America/Phoenix', { exact: true }).fill(date);
  await schedule.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(schedule.getByRole('status')).toContainText('Not sent yet');
  await expect(composer.getByLabel('Message body')).toHaveValue('');
  await schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await drawer.getByLabel('Conversation toolbar').getByRole('combobox').selectOption('sms');
  await composer.getByRole('button', { name: 'Schedule send', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Schedule send', exact: true }).getByText('Text sending and scheduling are unavailable until an SMS provider is connected.')).toBeVisible();
  await page.keyboard.press('Escape');
  await composer.getByLabel('Message body').fill('Do not send a text.');
  await expect(composer.getByRole('button', { name: 'Send Now', exact: true })).toBeDisabled();
  expect(schedules).toBe(1); expect(sends).toBe(0);
});

test('inbox schedules unmatched and account emails through its unified composer', async ({ page, data }) => {
  const keys: string[] = [];
  let sends = 0;
  const key = 'unmatched:synthetic@example.test';
  await page.route('**/api/communication/inbox?**', async (route) => route.fulfill({ json: {
    total: 2, conversations: [
      { key, kind: 'unmatched', client_id: null, lead_id: null, name: 'Synthetic unmatched',
        email: 'synthetic@example.test', address: 'synthetic@example.test', can_email: true, href: '', total: 1, unread: 0 },
      { key: `client:${data.account.id}`, kind: 'client', client_id: data.account.id, lead_id: null, name: 'Synthetic account',
        email: 'synthetic@example.test', address: 'synthetic@example.test', can_email: true, href: '', total: 1, unread: 0 },
    ],
  } }));
  await page.route('**/api/communication-log?**', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/communication-log', async (route) => {
    if (route.request().method() === 'POST') sends++;
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/gmail/threads?**', async (route) => route.fulfill({ json: {
    enabled: true, sender: { status: 'connected', name: 'QA agent', email: 'agent@example.test' },
    rows: [{ id: 'synthetic-thread-message', direction: 'inbound', subject: 'Policy review', body: 'Synthetic incoming email',
      sent_at: new Date().toISOString(), metadata: { from: 'synthetic@example.test', gmail_thread_id: 'synthetic-thread' } }],
  } }));
  await page.route('**/api/communication/scheduled?**', async (route) => {
    if (route.request().method() === 'POST') {
      keys.push(new URL(route.request().url()).searchParams.get('conversation') ?? '');
      expect(route.request().postDataJSON().send_at).toBe('2099-01-01T16:00:00.000Z');
      return route.fulfill({ status: 201, json: { status: 'pending' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/communication');
  await page.locator('[data-conversation-key]').filter({ hasText: 'Synthetic unmatched' }).click();
  await page.getByPlaceholder('Subject', { exact: true }).fill('Synthetic subject');
  await page.getByPlaceholder('Email Synthetic unmatched…', { exact: true }).fill('Synthetic unmatched draft');
  await page.getByRole('button', { name: 'Schedule send', exact: true }).click();
  await page.getByLabel('Send date and time - America/Phoenix', { exact: true }).fill('2099-01-01T09:00');
  await page.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Not sent yet');
  await page.keyboard.press('Escape');
  await page.locator('[data-conversation-key]').filter({ hasText: 'Synthetic account' }).click();
  const composer = page.locator('[data-message-composer="email"]');
  await composer.getByRole('textbox', { name: 'Message subject', exact: true }).fill('Account review');
  await composer.getByRole('textbox', { name: 'Message body', exact: true }).fill('Synthetic account draft');
  await composer.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await schedule.getByLabel('Send date and time - America/Phoenix', { exact: true }).fill('2099-01-01T09:00');
  await schedule.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(schedule.getByRole('status')).toContainText('Not sent yet');
  expect(keys).toEqual([key, `client:${data.account.id}`]);
  expect(sends).toBe(0);
});

test('real synthetic lead, account and unmatched queues persist and cancel without outreach', async ({ context, authCookies }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) throw new Error('Supabase QA configuration required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createServerClient(url, anon, { cookies: { getAll: () => authCookies, setAll: () => {} } });
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user || user.user_metadata.crm_browser_qa !== true) throw new Error('Disposable QA identity required');
  const lead = randomUUID(), id = randomUUID(), endpoint = `/api/leads/${lead}/scheduled-messages`;
  const account = randomUUID(), accountSchedule = randomUUID(), unmatchedSchedule = randomUUID();
  try {
    const member = await db.from('agency_members').insert({ user_id: user.id, email: user.email, role: 'agent', active: true });
    if (member.error) throw new Error('Synthetic membership creation failed');
    const created = await db.from('leads').insert({ id: lead, full_name: 'Synthetic scheduling QA', email: 'synthetic@example.test',
      status: 'new', source: 'browser_qa', agent_user_id: user.id });
    if (created.error) throw new Error('Synthetic lead creation failed');
    const body = { request_id: id, subject: 'Synthetic scheduled email', body: 'Synthetic QA only', send_at: '2099-01-01T16:00:00Z' };
    const response = await context.request.post(endpoint, { data: body });
    if (response.status() === 409) {
      expect(await response.json()).toMatchObject({ message: 'Connect your Gmail mailbox first.' });
      return;
    }
    expect(response.status()).toBe(201);
    expect((await context.request.post(endpoint, { data: body })).status()).toBe(200);
    const rows = await (await context.request.get(endpoint)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: 'pending' });
    expect((await context.request.delete(endpoint, { data: { id } })).status()).toBe(200);
    const saved = await db.from('scheduled_messages').select('status,client_id,lead_id').eq('id', id).single();
    if (saved.error) throw new Error('Synthetic queue persistence check failed');
    expect(saved.data).toMatchObject({ status: 'cancelled', client_id: null, lead_id: lead });
    const accountResult = await db.from('clients').insert({ id: account, full_name: 'Synthetic account scheduling QA',
      email: 'synthetic@example.test', email_consent: true, agent_user_id: user.id });
    if (accountResult.error) throw new Error('Synthetic scheduling account creation failed');
    for (const [conversation, requestId] of [[`client:${account}`, accountSchedule], ['unmatched:synthetic@example.test', unmatchedSchedule]]) {
      const path = `/api/communication/scheduled?conversation=${encodeURIComponent(conversation)}`;
      const payload = { ...body, request_id: requestId };
      expect((await context.request.post(path, { data: payload })).status()).toBe(201);
      expect((await context.request.post(path, { data: payload })).status()).toBe(200);
      const entries = await (await context.request.get(path)).json();
      expect(entries.some((entry: { id: string }) => entry.id === requestId)).toBe(true);
      expect((await context.request.delete(path, { data: { id: requestId } })).status()).toBe(200);
      const row = await db.from('scheduled_messages').select('status,client_id,lead_id,approved_recipient').eq('id', requestId).single();
      if (row.error) throw new Error('Synthetic communication queue persistence check failed');
      expect(row.data).toMatchObject({ status: 'cancelled', lead_id: null, approved_recipient: 'synthetic@example.test',
        client_id: conversation.startsWith('client:') ? account : null });
    }
    const log = await db.from('communication_log').select('id').contains('metadata', { lead_id: lead });
    if (log.error) throw new Error('No-send check failed');
    expect(log.data).toHaveLength(0);
  } finally {
    const results = [
      await db.from('scheduled_messages').delete().eq('id', id).eq('lead_id', lead),
      await db.from('scheduled_messages').delete().in('id', [accountSchedule, unmatchedSchedule]).eq('agent_user_id', user.id),
      await db.from('clients').delete().eq('id', account).eq('agent_user_id', user.id),
      await db.from('leads').delete().eq('id', lead),
      await db.from('agency_members').delete().eq('user_id', user.id),
    ];
    if (results.some((result) => result.error)) throw new Error('Synthetic scheduling cleanup failed');
  }
});
