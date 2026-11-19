import { test, expect } from './workspace-fixtures';
import type { SocialDraft, SocialMediaAsset, SocialIntent, SocialEngineCommand, SocialEngineList, SocialPublishConnection } from '@crm/shared';

test('social workspace has visual browsing, separate media, live preview and responsive save controls', async ({ page, context }) => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const mediaId = '22222222-2222-4222-8222-222222222222';
  const post: SocialDraft = {
    id: '33333333-3333-4333-8333-333333333333', workspace_id: actor, title: 'A fresh look at your coverage',
    caption: 'A new season is a good time to review your coverage.\nTalk with our team about your options.',
    media_ids: [mediaId], revision: 2, review_state: 'awaiting_review', review_version: 1,
    status: 'draft', created_by: actor, updated_by: actor, created_at: '2026-11-05T12:00:00Z', updated_at: '2026-11-05T12:00:00Z',
  };
  const asset: SocialMediaAsset = {
    id: mediaId, workspace_id: actor, file_name: 'coverage-review.jpg', alt_text: 'Coverage review artwork',
    rights_reference: 'Agency-owned test artwork', status: 'ready', width: 640, height: 480,
    byte_size: 2048, error_message: null, created_by: actor, created_at: post.created_at,
  };
  const socialRequests: string[] = [];
  const connectionCommands: Array<Record<string, unknown>> = [];
  let oauthReady = false;
  const unexpectedRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/social-marketing/')) socialRequests.push(url.pathname);
    if (url.pathname === '/api/social-marketing/media') {
      if (route.request().method() === 'POST') {
        expect(route.request().postData()).toContain('Artwork for a coverage review');
        expect(route.request().postData()).toContain('Agency-owned');
        await route.fulfill({ status: 201, json: asset });
      } else if (url.searchParams.has('id')) {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#12334a"/><circle cx="520" cy="80" r="190" fill="#20a8d8"/><text x="40" y="300" fill="white" font-family="sans-serif" font-size="38">Coverage that fits.</text></svg>' });
      } else await route.fulfill({ json: { assets: [asset], total: 1 } });
      return;
    }
    if (url.pathname === '/api/social-marketing/drafts') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { title: string; caption: string; media_ids: string[] };
        Object.assign(post, body, { revision: post.revision + 1, review_state: 'not_submitted', review_version: post.review_version + 1 });
        await route.fulfill({ json: post });
      } else if (url.searchParams.has('id')) {
        await route.fulfill({ json: { post, history: [], reviews: [], can_review: true } });
      } else {
        const status = url.searchParams.get('status');
        const posts = status === 'draft' || status === post.review_state ? [post] : [];
        await route.fulfill({ json: { posts, total: posts.length, can_review: true } });
      }
      return;
    }
    if (url.pathname === '/api/social-marketing/reviews') {
      const body = route.request().postDataJSON() as { action: string; reason: string };
      expect(body.action).toBe('request_changes');
      expect(body.reason).toBe('Please update the caption.');
      post.review_state = 'changes_requested';
      post.review_version++;
      await route.fulfill({ json: post });
      return;
    }
    if (url.pathname === '/api/social-marketing/connections') {
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON() as Record<string, unknown>;
        connectionCommands.push(command);
        await route.fulfill({ json: { id: '44444444-4444-4444-8444-444444444444', state: 'disconnected' } });
        return;
      }
      if (oauthReady) {
        await route.fulfill({ json: {
          enabled: true, setup_issues: [], can_manage: true, connections: [], grants: [],
          candidates: [{
            id: '123456789', name: 'Agency Page', category: 'Insurance', tasks: ['CREATE_CONTENT'],
            can_publish_facebook: true, facebook_block_reason: null,
            instagram_business_account: { id: '987654321', username: 'agency' },
            can_publish_instagram: true, instagram_block_reason: null,
          }],
          oauth_expires_at: '2026-11-06T21:00:00Z', discovery_error: null,
        } });
        return;
      }
      await route.fulfill({ json: {
        enabled: false,
        setup_issues: ['Set SOCIAL_META_CONNECTIONS_ENABLED=true after provider review.'],
        can_manage: true, connections: [], grants: [{
          id: '44444444-4444-4444-8444-444444444444', user_name: 'Agency Page login', state: 'connected',
          granted_scopes: ['pages_show_list'], token_expires_at: '2027-01-01T00:00:00Z',
        }], candidates: [], oauth_expires_at: null, discovery_error: null,
      } });
      return;
    }
    if (url.pathname === '/api/shell') {
      await route.fulfill({ json: { overdueCount: 0, dueTodayCount: 0, unreadCount: 0, notifications: [], unreadMessages: { total: 0, byClient: {}, byLead: {} } } });
      return;
    }
    if (url.pathname === '/api/leads/attention') {
      await route.fulfill({ json: { leads: [], total: 0 } });
      return;
    }
    unexpectedRequests.push(url.pathname);
    await route.fulfill({ status: 501, json: { message: `Unexpected UI fixture request: ${url.pathname}` } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/communication/social');
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await expect(page.getByRole('button', { name: post.title, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: `${post.title} image`, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Image library', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.getByRole('button', { name: 'Connected accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connected accounts', exact: true })).toBeVisible();
  await expect(page.getByText('Connecting Meta accounts is currently unavailable. Resolve these setup items before enabling it:', { exact: true })).toBeVisible();
  await expect(page.getByText('Set SOCIAL_META_CONNECTIONS_ENABLED=true after provider review.', { exact: true })).toBeVisible();
  await expect(page.getByText('No social accounts connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Meta account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revoke Meta authorization', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke Meta authorization', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('All accounts connected through that login are disabled.');
  await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Meta authorization revoked.');
  expect(connectionCommands).toEqual([{ action: 'revoke_grant', grant_id: '44444444-4444-4444-8444-444444444444' }]);
  await expect(page.getByText('Real social publishing is not available yet.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Posts', exact: true }).click();
  await page.getByRole('searchbox').fill('nothing matches');
  await expect(page.getByText('No matching posts', { exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  if (process.env.CRM_SOCIAL_UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.CRM_SOCIAL_UI_SCREENSHOTS}\\social-workspace.png` });
  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Image library', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Image alt text' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Image alt text' })).toBeVisible();
  await page.getByLabel('Image file', { exact: true }).setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert').filter({ hasText: 'Choose one JPEG/PNG image of up to 4 MB.' })).toBeVisible();
  await page.getByText('Drop an image or browse files', { exact: true }).locator('..').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['local-ui-fixture'], 'dropped.jpg', { type: 'image/jpeg' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByText('dropped.jpg', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Image alt text' }).fill('Artwork for a coverage review');
  await page.getByRole('textbox', { name: 'Usage rights/source' }).fill('Agency-owned');
  await page.getByRole('button', { name: 'Upload to library', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Image uploaded and ready.' })).toBeVisible();
  await page.getByRole('button', { name: 'Posts', exact: true }).click();
  await page.getByRole('button', { name: post.title, exact: true }).click();
  const preview = page.getByRole('complementary', { name: 'Post preview' });
  await expect(preview).toContainText(post.caption);
  await expect(page.getByRole('button', { name: 'Approve content', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Saved revision 2');
  await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('Preview updates while you write.');
  await expect(preview).toContainText('Preview updates while you write.');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Unsaved changes');
  await expect(page.getByRole('button', { name: 'Approve content', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Selected image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide image library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Caption', exact: true }).fill(post.caption);
  if (process.env.CRM_SOCIAL_UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.CRM_SOCIAL_UI_SCREENSHOTS}\\social-composer.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport();
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (process.env.CRM_SOCIAL_UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.CRM_SOCIAL_UI_SCREENSHOTS}\\social-composer-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('textbox', { name: 'Review note (required for changes)' }).fill('Please update the caption.');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes requested.' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Draft status', exact: true }).selectOption('changes_requested');
  await page.getByRole('button', { name: post.title, exact: true }).click();
  await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('Updated coverage caption.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved (revision 3).' })).toBeVisible();
  await expect(page.getByText('No posts in this view', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Draft status', exact: true }).selectOption('draft');
  await expect(page.getByRole('button', { name: post.title, exact: true })).toBeVisible();
  await expect(page.getByText('Updated coverage caption.', { exact: true })).toBeVisible();
  oauthReady = true;
  await page.goto('/communication/social?connection=ready');
  await expect(page.getByRole('heading', { name: 'Choose authorized Pages', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Meta authorization succeeded.' })).toBeVisible();
  await expect(page).not.toHaveURL(/connection=ready/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect Page', exact: true }).click();
  expect(connectionCommands).toEqual([
    { action: 'revoke_grant', grant_id: '44444444-4444-4444-8444-444444444444' },
    { action: 'select_page', page_id: '123456789', include_instagram: true },
  ]);
  expect(unexpectedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(socialRequests.every((path) => ['/api/social-marketing/drafts', '/api/social-marketing/media', '/api/social-marketing/reviews', '/api/social-marketing/connections'].includes(path))).toBe(true);
});

  test('approved content has destination-bound review, safe scheduling and truthful test calendar controls', async ({ page, context }) => {
    const actor = '11111111-1111-4111-8111-111111111111';
    const post: SocialDraft = { id: '33333333-3333-4333-8333-333333333333', workspace_id: actor,
      title: 'Ready for test scheduling', caption: 'Ask our team about your coverage.', media_ids: [], revision: 2,
      review_state: 'approved', review_version: 2, status: 'draft', created_by: actor, updated_by: actor,
      created_at: '2026-11-05T12:00:00Z', updated_at: '2026-11-05T12:00:00Z' };
    const intents: SocialIntent[] = [];
    let paused = true;
    let scheduleRequests = 0;
    let rejectSchedule = true;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/shell') await route.fulfill({ json: { overdueCount: 0, dueTodayCount: 0, unreadCount: 0, notifications: [], unreadMessages: { total: 0, byClient: {}, byLead: {} } } });
      else if (path === '/api/leads/attention') await route.fulfill({ json: { leads: [], total: 0 } });
      else if (path === '/api/social-marketing/drafts') await route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? { post, history: [], reviews: [], can_review: true } : { posts: [post], total: 1, can_review: true } });
      else if (path === '/api/social-marketing/engine') {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON() as SocialEngineCommand;
          if (body.action === 'prepare') {
            expect(body.post_id).toBe(post.id); expect(body.revision).toBe(2); expect(body.scenario).toBe('success');
            intents.push({ id: body.id, post_id: post.id, title: post.title, revision: 2, destination: 'test', scenario: body.scenario,
              connection_id: null, remote_id: null, permalink: null, publish_dispatched_at: null, container_status: 'none',
              state: 'awaiting_approval', version: 1, scheduled_at: null, timezone: 'America/Phoenix',
              attempt_count: 0, message: 'Destination approval required.', receipt_id: null, updated_at: post.updated_at, events: [], attempts: [] });
          } else if (body.action === 'pause') paused = body.paused;
          else if (body.action === 'prepare_publish') throw new Error('This test covers the test adapter only.');
          else {
            expect(body.id).toBe(intents[0].id); expect(body.expected_version).toBe(intents[0].version);
            if (body.action === 'approve') intents[0].state = 'approved';
            else if (body.action === 'schedule') {
              scheduleRequests++;
              if (rejectSchedule) { rejectSchedule = false; await route.fulfill({ status: 409, json: { message: 'This intent changed. Reload before continuing.' } }); return; }
              expect(body.timezone).toBe('America/Phoenix'); expect(body.scheduled_at).toMatch(/Z$/);
              intents[0].state = 'scheduled'; intents[0].scheduled_at = body.scheduled_at;
            } else if (body.action === 'cancel') intents[0].state = 'canceled';
            else if (body.action === 'confirm') { intents[0].state = 'simulated'; intents[0].receipt_id = `test-${intents[0].id}`; }
            else throw new Error(`Unexpected engine action: ${body.action}`);
            intents[0].version++;
          }
        }
        await route.fulfill({ json: { intents, connections: [], paused, can_manage: true, worker_seen_at: null, worker_test_enabled: false, worker_real_enabled: false } });
      } else throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto('/communication/social');
    await page.getByRole('button', { name: post.title, exact: true }).click();
    await page.getByRole('button', { name: 'Prepare test destination', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve test destination', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schedule / reschedule test', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve test destination', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule / reschedule test', exact: true }).click();
    const date = new Date(Date.now() + 3600000).toISOString().slice(0,16);
    await page.getByLabel('Arizona date & time').fill(date);
    await page.getByRole('button', { name: 'Confirm test schedule', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This intent changed.' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm test schedule', exact: true }).click();
    await expect(page.getByText('Scheduled test', { exact: false }).first()).toBeVisible();
    expect(scheduleRequests).toBe(2);
    await expect(page.getByText('Publishing worker is not responding. Refresh to check again, or contact support.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume publishing engine', exact: true }).click();
    await expect(page.getByText('Dispatch allowed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close composer', exact: true }).click();
    await page.getByRole('button', { name: 'Publishing calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Month calendar', exact: true }).click();
    await expect(page.locator('.fc-daygrid')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel test', exact: true }).click();
    await expect(page.getByText('Canceled', { exact: false }).first()).toBeVisible();
    // Test-only fixture mutation represents an acknowledgement lost after dispatch.
    intents[0].state = 'confirming'; intents[0].version++;
    await page.getByRole('button', { name: 'Refresh execution', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel test', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Confirm test outcome', exact: true }).click();
    await expect(page.getByText('Test completed', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(`Test receipt: test-${intents[0].id}`, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'Social Marketing', exact: true }).click();
    await page.getByRole('button', { name: 'Execution list', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

test('live publish now requires destination approval and an active unpaused worker', async ({ page, context }) => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const post: SocialDraft = {
    id: '33333333-3333-4333-8333-333333333333', workspace_id: actor, title: 'Ready for Facebook',
    caption: 'Ask our team about your coverage.', media_ids: [], revision: 2, review_state: 'approved',
    review_version: 2, status: 'draft', created_by: actor, updated_by: actor,
    created_at: '2026-11-05T12:00:00Z', updated_at: '2026-11-05T12:00:00Z',
  };
  const connection: SocialPublishConnection = {
    id: '44444444-4444-4444-8444-444444444444', platform: 'facebook_page', account_name: 'Agency Page',
    state: 'connected', can_publish: true, capability_reason: null, token_expires_at: '2027-01-01T00:00:00Z',
  };
  let intent: SocialIntent | null = null;
  let workerEnabled = false;
  const scheduleCommands: Extract<SocialEngineCommand, { action: 'schedule' }>[] = [];
  const list = (): SocialEngineList => ({
    intents: intent ? [intent] : [], connections: [connection], paused: false, can_manage: true,
    worker_seen_at: workerEnabled ? new Date().toISOString() : null, worker_test_enabled: false, worker_real_enabled: workerEnabled,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/shell') {
      await route.fulfill({ json: { overdueCount: 0, dueTodayCount: 0, unreadCount: 0, notifications: [], unreadMessages: { total: 0, byClient: {}, byLead: {} } } });
    } else if (url.pathname === '/api/leads/attention') {
      await route.fulfill({ json: { leads: [], total: 0 } });
    } else if (url.pathname === '/api/social-marketing/drafts') {
      await route.fulfill({ json: url.searchParams.has('id') ? { post, history: [], reviews: [], can_review: true } : { posts: [post], total: 1, can_review: true } });
    } else if (url.pathname === '/api/social-marketing/connections') {
      await route.fulfill({ json: { enabled: false, setup_issues: [], can_manage: true, connections: [], grants: [], candidates: [], oauth_expires_at: null, discovery_error: null } });
    } else if (url.pathname === '/api/social-marketing/engine') {
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON() as SocialEngineCommand;
        if (command.action === 'prepare_publish') {
          expect(command.connection_id).toBe(connection.id);
          intent = {
            id: command.id, post_id: post.id, title: post.title, revision: post.revision, destination: 'facebook_page', scenario: null,
            connection_id: connection.id, remote_id: null, permalink: null, publish_dispatched_at: null, container_status: 'none',
            state: 'awaiting_approval', version: 1, scheduled_at: null, timezone: 'America/Phoenix', attempt_count: 0,
            message: 'Owner/admin approval required.', receipt_id: null, updated_at: post.updated_at, events: [], attempts: [],
          };
        } else if (command.action === 'approve' && intent) {
          intent.state = 'approved'; intent.version++;
        } else if (command.action === 'schedule' && intent) {
          scheduleCommands.push(command);
          intent.state = 'scheduled'; intent.scheduled_at = command.scheduled_at; intent.version++;
        } else {
          throw new Error(`Unexpected engine action: ${command.action}`);
        }
      }
      await route.fulfill({ json: list() });
    } else {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
  });
  await page.goto('/communication/social');
  await page.getByRole('button', { name: post.title, exact: true }).click();
  await page.getByLabel('Live destination').selectOption(connection.id);
  await page.getByRole('button', { name: 'Prepare live target', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve live destination', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve live destination', exact: true }).click();
  const publishNow = page.getByRole('button', { name: 'Publish now', exact: true });
  await expect(publishNow).toBeDisabled();
  workerEnabled = true;
  await page.getByRole('button', { name: 'Refresh execution', exact: true }).click();
  await expect(publishNow).toBeEnabled();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Agency Page');
    await dialog.accept();
  });
  const clickedAt = Date.now();
  await publishNow.click();
  await expect.poll(() => scheduleCommands.length).toBe(1);
  const scheduledAt = Date.parse(scheduleCommands[0].scheduled_at);
  expect(scheduledAt).toBeGreaterThan(clickedAt);
  expect(scheduledAt).toBeLessThan(clickedAt + 15000);
  expect(scheduleCommands[0].timezone).toBe('America/Phoenix');
  expect(pageErrors).toEqual([]);
});

test('new draft upload recovers from failure and caption help never spends credits automatically', async ({ page, context }) => {
  const mediaId = '22222222-2222-4222-8222-222222222222';
  let uploads = 0;
  let generations = 0;
  let releaseUpload: () => void = () => { throw new Error('Upload gate missing.'); };
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/shell') await route.fulfill({ json: { overdueCount: 0, dueTodayCount: 0, unreadCount: 0, notifications: [], unreadMessages: { total: 0, byClient: {}, byLead: {} } } });
    else if (path === '/api/leads/attention') await route.fulfill({ json: { leads: [], total: 0 } });
    else throw new Error(`Unexpected request: ${path}`);
  });
  await context.route('**/api/social-marketing/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/drafts')) {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { posts: [], total: 0 } });
    } else if (path.endsWith('/captions')) {
      if (route.request().method() === 'GET') await route.fulfill({ json: { available: true } });
      else {
        generations++;
        expect(route.request().postDataJSON().topic).toBe('Coverage review');
        await route.fulfill({ json: { captions: ['A simple coverage check-in.', 'Review your options with our team.', 'Ask an insurance question today.'] } });
      }
    } else if (path.endsWith('/media')) {
      if (route.request().method() === 'POST') {
        uploads++;
        if (uploads === 1) await route.fulfill({ status: 503, json: { message: 'Image storage failed. Upload the image again.' } });
        else {
          await uploadGate;
          await route.fulfill({ status: 201, json: { id: mediaId, status: 'ready', alt_text: 'Agency photo' } });
        }
      } else if (new URL(route.request().url()).searchParams.has('id')) {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#20a8d8"/></svg>' });
      } else await route.fulfill({ json: { assets: [], total: 0 } });
    } else throw new Error(`Unexpected social request: ${path}`);
  });
  await page.goto('/communication/social');
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New draft', exact: true });
  await page.getByRole('textbox', { name: 'Internal title', exact: true }).fill('My new post');
  await page.getByRole('button', { name: 'Caption help', exact: true }).click();
  await page.getByRole('button', { name: 'Coverage review', exact: true }).click();
  expect(generations).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Use caption', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue(/Life changes/);
  await page.getByRole('textbox', { name: 'Post topic', exact: true }).fill('Coverage review');
  await page.getByRole('button', { name: 'Generate 3 captions (uses AI credits)', exact: true }).click();
  await page.getByRole('button', { name: 'Preview option 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).not.toHaveValue('A simple coverage check-in.');
  await page.getByRole('button', { name: 'Replace caption', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue('A simple coverage check-in.');
  expect(generations).toBe(1);
  await page.getByRole('button', { name: 'Hide caption help', exact: true }).click();
  await page.getByRole('button', { name: 'Add image', exact: true }).click();
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByText('Drop an image or browse files', { exact: true }).click();
  await (await picker).setFiles({ name: 'agency.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('local fixture') });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'agency.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('local fixture') });
  await expect(page.getByText('agency.jpg', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Image alt text', exact: true }).fill('Agency photo');
  await page.getByRole('textbox', { name: 'Usage rights/source', exact: true }).fill('Agency-owned');
  await page.getByRole('textbox', { name: 'Usage rights/source', exact: true }).press('Enter');
  await expect(dialog).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Upload to library', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Image storage failed.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Image alt text', exact: true })).toHaveValue('Agency photo');
  await expect(page.getByText('agency.jpg', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Upload to library', exact: true }).click();
  try {
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Close composer', exact: true })).toBeDisabled();
  } finally { releaseUpload(); }
  await expect(page.getByRole('img', { name: 'Attached draft image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  expect(uploads).toBe(2);
});
