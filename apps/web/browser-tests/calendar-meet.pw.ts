import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, leadId } from './workspace-fixtures';

test('calendar connection is separate from Gmail and supports visible connection failures', async ({ page }) => {
  let unavailable = false, connectRequests = 0;
  await page.route('**/api/google-calendar', (route) => route.fulfill(unavailable
    ? { status: 503, json: { message: 'Calendar status temporarily unavailable.' } }
    : { json: { connection: null } }));
  await page.route('**/api/google-calendar/connect', (route) => {
    connectRequests++;
    return route.fulfill({ status: 503, json: { message: 'Google Calendar authorization could not be started.' } });
  });
  await page.goto('/account?tab=signature');
  await expect(page.getByRole('button', { name: 'Connect Google Calendar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'authorization could not be started' })).toBeVisible();
  expect(connectRequests).toBe(1);
  unavailable = true;
  await page.getByRole('button', { name: 'Refresh calendar status', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Calendar status temporarily unavailable' })).toBeVisible();
});

test('conversation booking includes meeting type and duration, reschedules and cancels without losing history', async ({ page, data }) => {
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.locator('[data-message-composer="email"]').getByRole('button', { name: 'Appointments', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await popup.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await popup.getByLabel('Appointment title', { exact: true }).fill('Coverage review');
  await popup.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-15T10:30');
  await popup.getByRole('combobox', { name: 'Meeting type', exact: true }).selectOption('google_meet');
  await popup.getByRole('combobox', { name: 'Duration', exact: true }).selectOption('45');
  await expect(popup.getByRole('link', { name: 'Calendar connection' })).toHaveAttribute('href', '/account?tab=signature');
  await popup.getByRole('checkbox', { name: 'Send appointment confirmation from my Gmail after saving.' }).uncheck();
  await popup.getByRole('button', { name: 'Save appointment', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('saved');
  expect(data.events).toHaveLength(1);
  await popup.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await popup.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-16T11:00');
  await popup.getByRole('checkbox', { name: 'Send appointment confirmation from my Gmail after saving.' }).uncheck();
  await popup.getByRole('button', { name: 'Save reschedule', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('rescheduled');
  expect(data.events).toHaveLength(1);
  expect(data.events[0]).toMatchObject({ event_date: '2030-01-16', event_time: '11:00', duration_minutes: 45, meeting_type: 'google_meet' });
  page.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('cancelled');
  expect(data.events).toHaveLength(1);
  expect(data.events[0]?.status).toBe('cancelled');
  await expect(popup.getByRole('button', { name: 'Cancel appointment', exact: true })).toHaveCount(0);
});

test('calendar retains cancelled appointments and offers no false completion or reopen action', async ({ page, data }) => {
  data.events.push({ id: 'ac753cd3-cd0d-423b-a30e-66d2709d0d5e', title: 'Client review', subject: 'Client review',
    event_date: '2030-01-15', event_time: '10:30', all_day: false, status: 'scheduled', related_type: 'lead', related_id: leadId, updated_at: data.stamp() });
  await page.goto('/scheduler?view=list');
  await page.getByRole('checkbox', { name: 'Email contacts about cancellations and reschedules' }).uncheck();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('cancelled');
  await expect(page.getByRole('button', { name: 'Client review', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0);
  expect(data.events[0]?.status).toBe('cancelled');
});

test('customer appointment link works without CRM navigation or private data and cancels', async ({ page }) => {
  const token = 'A'.repeat(43);
  const posts: Array<Record<string, unknown>> = [];
  let appointment = { id: 'public-1', subject: 'Coverage review', event_date: '2030-01-15', event_time: '10:30', all_day: false, status: 'scheduled',
    meeting_type: 'google_meet', duration_minutes: 30, location: null, google_meet_url: 'https://meet.google.com/abc-defg-hij', sync_error: null, revision: 3, time_zone: 'America/Phoenix' };
  await page.route(`**/api/appointments/manage/${token}`, async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON() as Record<string, unknown>);
      appointment = { ...appointment, status: 'cancelled', revision: 4 };
      return route.fulfill({ json: { appointment, notification: { status: 'not_requested' } } });
    }
    return route.fulfill({ json: { appointment } });
  });
  const internal: string[] = [];
  page.on('request', (request) => { if (/\/api\/(notifications|leads|clients|tasks)/.test(request.url())) internal.push(request.url()); });
  await page.goto(`/appointments/manage/${token}`);
  await expect(page.getByRole('heading', { name: 'Your appointment' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join Google Meet' })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  expect(posts).toEqual([{ action: 'cancel', revision: 3 }]);
  await expect(page.getByRole('link', { name: 'Join Google Meet' })).toHaveCount(0);
  expect(internal).toEqual([]);
});

test('failed calendar sync can be retried from the conversation', async ({ page }) => {
  let syncs = 0, failed = true;
  await page.route('**/api/events?related_type=lead*', (route) => route.fulfill({ json: [{ id: 'sync-1', subject: 'Coverage review', event_date: '2030-01-15', event_time: '10:30',
    status: 'scheduled', meeting_type: 'google_meet', duration_minutes: 30, sync_status: failed ? 'failed' : 'synced', sync_error: failed ? 'Calendar update needs an agency retry.' : null,
    google_meet_url: failed ? null : 'https://meet.google.com/abc-defg-hij', updated_at: '2030-01-01T00:00:00Z' }] }));
  await page.route('**/api/events/sync-1/sync', (route) => { syncs++; failed = false; return route.fulfill({ json: {} }); });
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.locator('[data-message-composer="email"]').getByRole('button', { name: 'Appointments', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await expect(popup.getByRole('alert')).toContainText('needs an agency retry');
  await popup.getByRole('button', { name: 'Retry calendar sync', exact: true }).click();
  await expect(popup.getByRole('link', { name: 'Join Meet' })).toBeVisible();
  expect(syncs).toBe(1);
});

test('real appointment lifecycle keeps cancelled history, cancels its task and rejects Meet without a connection', async ({ context, authCookies }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for persistence verification.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error('Supabase QA configuration required');
  const auth = createServerClient(url, anon, { cookies: { getAll: () => authCookies, setAll: () => {} } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new Error('Temporary verification user is unavailable.');
  const accountId = randomUUID(), eventId = randomUUID(), meetId = randomUUID();
  try {
    const member = await admin.from('agency_members').insert({ user_id: user.id, email: user.email, role: 'agent', active: true });
    if (member.error) throw new Error(member.error.message);
    const account = await admin.from('clients').insert({ id: accountId, full_name: 'Disposable appointment lifecycle' });
    if (account.error) throw new Error(account.error.message);
    const created = await context.request.post('/api/events', { data: { id: eventId, subject: 'Disposable lifecycle call', event_date: '2030-03-04', event_time: '10:00',
      all_day: false, related_type: 'client', related_id: accountId, meeting_type: 'phone', duration_minutes: 45 } });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const rescheduled = await context.request.patch('/api/events', { data: { id: eventId, event_date: '2030-03-05', event_time: '11:30' } });
    expect(rescheduled.status(), await rescheduled.text()).toBe(200);
    const cancelled = await context.request.patch('/api/events', { data: { id: eventId, status: 'cancelled' } });
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    const event = await admin.from('events').select('status,event_date,event_time,duration_minutes').eq('id', eventId).single();
    expect(event.data).toMatchObject({ status: 'cancelled', event_date: '2030-03-05', event_time: '11:30', duration_minutes: 45 });
    const task = await admin.from('tasks').select('status').eq('event_id', eventId);
    expect(task.data?.map((row) => row.status)).toEqual(['cancelled']);
    const revived = await context.request.patch('/api/events', { data: { id: eventId, status: 'scheduled' } });
    expect(revived.status()).toBe(409);
    const meet = await context.request.post('/api/events', { data: { id: meetId, subject: 'Disposable Meet', event_date: '2030-03-06', event_time: '10:00',
      all_day: false, related_type: 'client', related_id: accountId, meeting_type: 'google_meet', duration_minutes: 30 } });
    const meetBody = await meet.text();
    expect((await admin.from('events').select('id').eq('id', meetId)).data?.length ? meet.status() : 400, meetBody).toBeLessThan(500);
  } finally {
    const ids = [eventId, meetId];
    await admin.from('notifications').delete().in('event_id', ids);
    await admin.from('tasks').delete().in('event_id', ids);
    await admin.from('events').delete().in('id', ids);
    await admin.from('client_activities').delete().eq('client_id', accountId);
    const removed = await admin.from('clients').delete().eq('id', accountId);
    const unmember = await admin.from('agency_members').delete().eq('user_id', user.id);
    if (removed.error || unmember.error) throw new Error('Cleanup failed.');
  }
});
