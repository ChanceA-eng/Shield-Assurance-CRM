import { test, expect, leadId } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { oauthStateHash } from '../src/lib/gmail-provider';

test('selected contacts retain separate reviewed Gmail schedules and cancellation', async ({ page }) => {
  const other = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
  const contacts = [
    { id: leadId, full_name: 'First fixture', email: 'first@example.invalid' },
    { id: other, full_name: 'Second fixture', email: 'second@example.invalid' },
  ];
  const writes: Array<{ id: string; body: Record<string, unknown> }> = [];
  let cancelled = false;
  await page.route('**/api/leads?limit=1000', (route) => route.fulfill({ json: contacts }));
  await page.route('**/api/agency/time-zone', (route) => route.fulfill({ json: { time_zone: 'America/Phoenix' } }));
  await page.route('**/api/leads/*/scheduled-messages', async (route) => {
    const id = route.request().url().split('/').at(-2) ?? '';
    if (route.request().method() === 'POST') {
      const body: Record<string, unknown> = route.request().postDataJSON();
      writes.push({ id, body });
      await route.fulfill({ status: 201, json: { ...body, id: body.request_id, status: 'pending', last_error: null } });
    } else if (route.request().method() === 'DELETE') {
      cancelled = true;
      await route.fulfill({ json: { status: 'cancelled' } });
    } else {
      const write = writes.find((row) => row.id === id);
      await route.fulfill({ json: write && !cancelled ? [{ ...write.body, id: write.body.request_id, status: 'pending', last_error: null }] : [] });
    }
  });

  await page.goto('/communication/reviewed-email', { waitUntil: 'domcontentloaded' });
  for (const contact of contacts) await page.getByLabel(`Select ${contact.full_name}`, { exact: true }).check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  const first = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'First fixture', exact: true }) });
  await page.getByLabel('Subject for First fixture', { exact: true }).fill('First subject');
  await page.getByLabel('Message for First fixture', { exact: true }).fill('First independently reviewed message.');
  await first.getByRole('button', { name: 'Schedule send', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule send', exact: true });
  await schedule.getByLabel('Reviewed email for First fixture', { exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Subject for First fixture', { exact: true }).fill('Edited subject');
  await first.getByRole('button', { name: 'Schedule send', exact: true }).click();
  await expect(schedule.getByLabel('Reviewed email for First fixture', { exact: true })).not.toBeChecked();
  await schedule.getByLabel('Reviewed email for First fixture', { exact: true }).check();
  await schedule.getByLabel(/Send date and time/).fill('2099-01-01T10:00');
  await schedule.getByRole('button', { name: 'Confirm schedule', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ id: leadId, body: { subject: 'Edited subject', body: 'First independently reviewed message.', email_provider: 'gmail' } });
  await expect(page.getByLabel('Message for Second fixture', { exact: true })).toHaveValue('');
  await schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true }).click();
  await expect(schedule.getByRole('button', { name: 'Cancel scheduled email', exact: true })).toHaveCount(0);
  expect(cancelled).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('configured production Gmail generates send-only authorization without connecting or sending', async ({ context, settingsOwner }) => {
  test.skip(process.env.CRM_GMAIL_CONFIG_QA !== '1', 'Run only against an intentionally Gmail-enabled deployment.');
  void settingsOwner;
  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !key) throw new Error('Supabase configuration is required for OAuth fixture cleanup.');
  const admin = createClient(databaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const response = await context.request.post('/api/gmail/connect', { data: { mode: 'send_only', accept_send_only: true } });
  expect(response.status(), await response.text()).toBe(200);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string') throw new Error('Gmail authorization response is invalid.');
  const url = new URL(data.url);
  const state = url.searchParams.get('state');
  if (!state) throw new Error('Gmail authorization state is missing.');
  try {
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://shield-assurance-crm.vercel.app/api/gmail/callback');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(url.searchParams.get('scope')).not.toContain('gmail.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const status = await context.request.get('/api/gmail');
    expect(status.status(), await status.text()).toBe(200);
    expect((await status.json()).connection).toBeNull();
  } finally {
    const removed = await admin.from('gmail_oauth_states').delete().eq('state_hash', oauthStateHash(state));
    if (removed.error) throw new Error('Could not remove the disposable Gmail authorization state.');
  }
});
