import { test, expect, leadId } from './workspace-fixtures';

test('Google Calendar replaces Zoom in account settings and new bookings', async ({ page }) => {
  await page.goto('/account?tab=signature');
  await expect(page.getByRole('button', { name: 'Connect Google Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Zoom', exact: true })).toHaveCount(0);
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.locator('[data-message-composer="email"]').getByRole('button', { name: 'Appointments', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await popup.getByRole('button', { name: 'Book appointment', exact: true }).click();
  const meetingType = popup.getByRole('combobox', { name: 'Meeting type', exact: true });
  await expect(meetingType.locator('option[value="google_meet"]')).toHaveCount(1);
  await expect(meetingType.locator('option[value="zoom"]')).toHaveCount(0);
});

test('existing Zoom appointments retain meeting type through reschedule and cancellation', async ({ page, data }) => {
  const existing = { id: 'ac753cd3-cd0d-423b-a30e-66d2709d0d5e', title: 'Zoom quote review', subject: 'Zoom quote review',
    event_date: '2030-01-15', event_time: '10:30', all_day: false, status: 'scheduled', meeting_type: 'zoom',
    duration_minutes: 30, related_type: 'lead', related_id: leadId, updated_at: data.stamp() };
  data.events.push(existing);
  await page.goto(`/leads?lead=${leadId}`);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.locator('[data-message-composer="email"]').getByRole('button', { name: 'Appointments', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appointments', exact: true });
  await popup.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(popup.getByRole('combobox', { name: 'Meeting type', exact: true })).toHaveValue('zoom');
  await popup.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-16T11:00');
  await popup.getByRole('checkbox', { name: 'Send appointment confirmation from my Gmail after saving.' }).uncheck();
  await popup.getByRole('button', { name: 'Save reschedule', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('rescheduled');
  page.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('cancelled');
  expect(data.events).toHaveLength(1);
  expect(data.events[0]).toMatchObject({ meeting_type: 'zoom', status: 'cancelled', event_date: '2030-01-16' });
});

test('public Zoom appointment shows only the attendee link and hides it after cancellation', async ({ page }) => {
  const token = 'Z'.repeat(43), updates: unknown[] = [];
  let appointment = { id: 'public-zoom', subject: 'Quote review', event_date: '2030-01-15', event_time: '10:30', all_day: false, status: 'scheduled',
    meeting_type: 'zoom', duration_minutes: 30, location: null, google_meet_url: null,
    zoom_join_url: 'https://us02web.zoom.us/j/12345678901?pwd=synthetic', sync_error: null, revision: 1, time_zone: 'America/Phoenix' };
  await page.route(`**/api/appointments/manage/${token}`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>; updates.push(body);
      appointment = { ...appointment, ...(body.action === 'cancel' ? { status: 'cancelled' } : { event_date: String(body.event_date), event_time: String(body.event_time) }), revision: appointment.revision + 1 };
      return route.fulfill({ json: { appointment, notification: { status: 'not_requested' } } });
    }
    return route.fulfill({ json: { appointment } });
  });
  await page.goto(`/appointments/manage/${token}`);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Join Zoom', exact: true })).toHaveAttribute('href', appointment.zoom_join_url);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Join Zoom', exact: true })).toHaveCount(0);
  expect(updates).toEqual([{ action: 'cancel', revision: 1 }]);
});

test('calendar Zoom appointments expose the attendee link and visible retry sync', async ({ page }) => {
  let syncs = 0;
  await page.route('**/api/events?**', (route) => route.fulfill({ json: [{
    id: 'zoom-scheduler', title: 'Zoom quote review', subject: 'Zoom quote review', event_date: '2030-01-15', event_time: '10:30',
    all_day: false, status: 'scheduled', meeting_type: 'zoom', duration_minutes: 30,
    zoom_join_url: 'https://us02web.zoom.us/j/12345678901', sync_status: syncs ? 'synced' : 'failed',
    sync_error: syncs ? null : 'Zoom needs a sync retry.', related_type: null, related_id: null,
  }] }));
  await page.route('**/api/events/zoom-scheduler/sync', (route) => { syncs++; return route.fulfill({ json: {} }); });
  await page.goto('/scheduler?view=list');
  await expect(page.getByRole('link', { name: 'Join Zoom', exact: true })).toHaveAttribute('href', 'https://us02web.zoom.us/j/12345678901');
  await page.getByRole('button', { name: 'Retry calendar sync', exact: true }).click();
  await expect(page.getByText('Zoom needs a sync retry.', { exact: false })).toHaveCount(0);
  expect(syncs).toBe(1);
});

test('uncertain Zoom creation requires explicit confirmation and preserves visible failures', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/api/events?**', (route) => route.fulfill({ json: [{
    id: 'zoom-uncertain', title: 'Uncertain Zoom meeting', subject: 'Uncertain Zoom meeting', event_date: '2030-01-15', event_time: '10:30',
    all_day: false, status: 'scheduled', meeting_type: 'zoom', duration_minutes: 30,
    zoom_meeting_id: null, zoom_create_attempted_at: '2030-01-01T00:00:00Z', revision: 3,
    sync_status: 'failed', sync_error: 'Zoom creation could not be confirmed.', related_type: null, related_id: null,
  }] }));
  await page.route('**/api/events/zoom-uncertain/sync', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { sync_status: 'failed', sync_error: 'Zoom is still unavailable. Retry sync.' } });
  });
  await page.goto('/scheduler?view=list');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'I checked Zoom: no meeting exists', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Zoom is still unavailable' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Calendar updated.' })).toHaveCount(0);
  expect(bodies).toEqual([{ confirm_zoom_not_created: true, expected_revision: 3 }]);
});

test('real Zoom status and unavailable setup are honest without modifying Google or sending outreach', async ({ context, settingsOwner }) => {
  void settingsOwner;
  const response = await context.request.get('/api/zoom');
  expect(response.status()).toBe(200);
  const result = await response.json() as { connection: unknown; configured: boolean };
  expect(result.connection).toBeNull();
  expect(typeof result.configured).toBe('boolean');
  if (!result.configured) {
    const unavailable = await context.request.post('/api/zoom/connect', { data: {} });
    expect(unavailable.status()).toBe(503);
    expect(await unavailable.json()).toMatchObject({ message: 'Zoom connection is not enabled yet. Contact your administrator.' });
  }
  const crossSite = await context.request.post('/api/zoom/connect', { data: {}, headers: { Origin: 'https://unrelated.example.invalid', 'Sec-Fetch-Site': 'cross-site' } });
  expect(crossSite.status()).toBe(403);
});
