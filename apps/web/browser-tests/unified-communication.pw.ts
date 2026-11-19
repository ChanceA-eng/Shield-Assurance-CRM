import { test, expect, leadId } from './workspace-fixtures';

for (const surface of ['lead', 'account', 'inbox'] as const) {
  test(`${surface} conversation books a calendar appointment and safely retries a lost save response`, async ({ page, data }) => {
    let appointment: Record<string, unknown> | null = null;
    let posts = 0;
    await page.route('**/api/events**', async (route) => {
      if (route.request().method() === 'POST') {
        posts++;
        appointment = { ...route.request().postDataJSON(), status: 'scheduled', updated_at: new Date().toISOString() };
        await route.fulfill({ status: 503, json: { message: 'The save response was interrupted. Retry your unchanged appointment.' } });
      } else await route.fulfill({ json: appointment ? [appointment] : [] });
    });
    await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
      key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
      email: data.lead.email, address: data.lead.email, can_email: true, total: 0, unread: 0,
    }] } }));
    await page.goto(surface === 'account' ? `/clients/${data.account.id}?tab=communication`
      : surface === 'lead' ? `/leads?lead=${leadId}` : `/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
    if (surface === 'lead') await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    const composer = page.locator('[data-message-composer="email"]');
    await expect(composer).toHaveCount(1);
    await composer.getByRole('textbox', { name: 'Message body', exact: true }).fill('Keep this message while I book a meeting.');
    await composer.getByRole('button', { name: 'Appointments', exact: true }).click();
    const appointmentPanel = page.getByRole('dialog', { name: 'Appointments', exact: true });
    await appointmentPanel.getByRole('button', { name: 'Book appointment', exact: true }).click();
    const title = `Synthetic ${surface} coverage review`;
    await appointmentPanel.getByLabel('Appointment title', { exact: true }).fill(title);
    await appointmentPanel.getByLabel('Appointment date and time', { exact: false }).fill('2030-01-15T10:30');
    await appointmentPanel.getByLabel('Appointment notes', { exact: true }).fill('Discuss the requested quote.');
    await appointmentPanel.getByRole('checkbox', { name: 'Send appointment confirmation from my Gmail after saving.' }).uncheck();
    await appointmentPanel.getByRole('button', { name: 'Save appointment', exact: true }).click();
    await expect(appointmentPanel.getByRole('alert')).toContainText('interrupted');
    await expect(appointmentPanel.getByLabel('Appointment title', { exact: true })).toHaveValue(title);
    await appointmentPanel.getByLabel('Appointment title', { exact: true }).fill(`${title} changed`);
    await appointmentPanel.getByRole('button', { name: 'Save appointment', exact: true }).click();
    await expect(appointmentPanel.getByRole('alert')).toContainText('previous appointment was saved');
    expect(posts).toBe(1);
    await appointmentPanel.getByLabel('Appointment title', { exact: true }).fill(title);
    await appointmentPanel.getByRole('button', { name: 'Save appointment', exact: true }).click();
    await expect(appointmentPanel.getByRole('status')).toContainText('Appointment saved to the calendar.');
    await expect(composer.getByRole('textbox', { name: 'Message body', exact: true })).toHaveValue('Keep this message while I book a meeting.');
    expect(posts).toBe(1);
    expect(appointment).toMatchObject({
      related_type: surface === 'account' ? 'client' : 'lead',
      related_id: surface === 'account' ? data.account.id : leadId,
      event_date: '2030-01-15', event_time: '10:30', subject: title, all_day: false,
    });
    await appointmentPanel.getByRole('link', { name: 'Open calendar', exact: true }).click();
    await page.goto('/scheduler?view=list');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(data.unexpected).toEqual([]);
  });
}

test('personal Gmail whole-plan approval is explicit and timing edits invalidate review', async ({ page }) => {
  let enrollment: unknown;
  let sends = 0;
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { default_provider: 'resend',
    connection: { email: 'agent@example.test', status: 'connected', sync_enabled: false } } }));
  await page.route('**/api/sales-sequences**', async (route) => {
    if (route.request().method() === 'POST') {
      enrollment = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { message: 'Reviewed Gmail sequence queued.' } });
    } else await route.fulfill({ json: { rows: [], actor: 'qa', appointments: [], quotes: [] } });
  });
  await page.route('**/api/communication-log', (route) => {
    if (route.request().method() === 'POST') sends++;
    return route.fulfill({ json: [] });
  });
  await page.goto(`/leads?lead=${leadId}`);
  const drawer = page.getByRole('complementary', { name: 'Lead profile' });
  await drawer.getByRole('button', { name: 'Conversation', exact: true }).click();
  await drawer.getByRole('button', { name: 'Follow-up sequences', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Follow-up sequences', exact: true });
  await panel.getByRole('checkbox', { name: 'Send all reviewed steps automatically from my Gmail.' }).check();
  const review = panel.getByRole('checkbox', { name: 'I reviewed these steps, timing and facts.' });
  await review.check();
  await panel.getByLabel('Days between steps', { exact: true }).fill('6');
  await expect(review).not.toBeChecked();
  await expect(panel.getByRole('button', { name: 'Start reviewed Gmail sequence', exact: true })).toBeDisabled();
  await review.check();
  await panel.getByRole('button', { name: 'Start reviewed Gmail sequence', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('queued');
  expect(enrollment).toMatchObject({ lead_id: leadId, email_provider: 'gmail', auto_send: true, confirmed: true, gap: 6 });
  expect(sends).toBe(0);
});

test('Gmail reply selection uses the main send action and never creates a second composer', async ({ page, data }) => {
  const reply = 'e04c06a4-a101-47b9-9095-e7f7f87fe3a7';
  let sent: unknown;
  await page.route('**/api/gmail', (route) => route.fulfill({ json: { default_provider: 'resend',
    connection: { email: 'agent@example.test', status: 'connected', sync_enabled: false } } }));
  await page.route('**/api/gmail/threads?**', (route) => route.fulfill({ json: { enabled: true,
    rows: [{ id: reply, subject: 'Requested quote', sent_at: new Date().toISOString(), gmail_url: 'https://mail.google.com/mail/u/agent@example.test/#all/fixture-thread' }] } }));
  await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
    key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
    email: data.lead.email, address: data.lead.email, can_email: true, total: 0, unread: 0,
  }] } }));
  await page.route('**/api/communication-log', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: reply, delivery: 'accepted_by_provider', provider: 'gmail' } });
  });
  await page.goto(`/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
  const composer = page.locator('[data-message-composer="email"]');
  await composer.getByRole('textbox', { name: 'Message body', exact: true }).fill('I can help with your requested quote.');
  await composer.getByRole('button', { name: 'Reply to an email', exact: true }).click();
  const replyPanel = page.getByRole('dialog', { name: 'Reply to an email', exact: true });
  await replyPanel.getByLabel('Email to reply to').selectOption(reply);
  await expect(replyPanel.getByRole('link', { name: 'Open in my Gmail', exact: true })).toHaveAttribute('href', /#all\/fixture-thread$/);
  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(1);
  await composer.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect.poll(() => sent).toMatchObject({
    email_provider: 'gmail', reply_to_message_id: reply, subject: 'Re: Requested quote', body: 'I can help with your requested quote.',
  });
  await expect(composer.getByRole('textbox', { name: 'Message body', exact: true })).toHaveValue('');
});

test('inbox AI drafting uses the same dossier opt-in and retains the draft on failure', async ({ page, data }) => {
  let input: unknown;
  let fail = true;
  await page.route('**/api/communication/inbox?**', (route) => route.fulfill({ json: { total: 1, conversations: [{
    key: `lead:${leadId}`, kind: 'lead', client_id: null, lead_id: leadId, name: data.lead.full_name,
    email: data.lead.email, address: data.lead.email, can_email: true, total: 0, unread: 0,
  }] } }));
  await page.route(`**/api/leads/${leadId}/draft-outreach`, async (route) => {
    input = route.request().postDataJSON();
    await route.fulfill(fail ? { status: 503, json: { message: 'Drafting unavailable. Your message is retained.' } }
      : { json: { subject: 'Requested review', body: 'I can help review the requested coverage.', cited_signals: ['Confirmed coverage request'] } });
  });
  await page.goto(`/communication?conversation=${encodeURIComponent(`lead:${leadId}`)}`);
  const composer = page.locator('[data-message-composer="email"]');
  await composer.getByRole('textbox', { name: 'Message body', exact: true }).fill('Draft a respectful coverage follow-up.');
  await composer.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  const draftPanel = page.getByRole('dialog', { name: 'Draft with AI', exact: true });
  const optIn = draftPanel.getByRole('checkbox', { name: 'Include current confirmed dossier findings in this AI draft only' });
  await expect(optIn).not.toBeChecked();
  await draftPanel.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await expect(draftPanel.getByRole('alert')).toContainText('Drafting unavailable');
  await expect(composer.getByRole('textbox', { name: 'Message body', exact: true })).toHaveValue('Draft a respectful coverage follow-up.');
  expect(input).toMatchObject({ include_dossier: false });
  fail = false;
  await optIn.check();
  await draftPanel.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Message body', exact: true })).toHaveValue('I can help review the requested coverage.');
  expect(input).toMatchObject({ include_dossier: true, mode: 'draft', instruction: 'Draft a respectful coverage follow-up.' });
  await expect(draftPanel.getByText('Draft grounding: Confirmed coverage request', { exact: true })).toBeVisible();
});
