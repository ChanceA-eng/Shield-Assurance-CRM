import { test, expect } from './workspace-fixtures';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SOCIAL_MEDIA_BUCKET, type SocialDraft, type SocialMediaAsset } from '@crm/shared';

test.setTimeout(180000);

test('native social drafts persist, preserve history, reject stale writes, and leave the calendar separate', async ({ page, context }) => {
  await context.unroute('**/api/**');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const database = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url || !key || !database) throw new Error('Supabase and direct database configuration are required for scoped live verification cleanup.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const identityResponse = await context.request.get('/api/account');
  expect(identityResponse.status()).toBe(200);
  const identity = await identityResponse.json() as { email: string };
  if (!identity.email.startsWith('crm-browser-') || !identity.email.endsWith('@example.invalid')) {
    throw new Error('Only the disposable browser-verification user may receive a temporary membership.');
  }
  let actor: string | null = null;
  for (let index = 1; !actor; index++) {
    const users = await admin.auth.admin.listUsers({ page: index, perPage: 100 });
    if (users.error) throw new Error('Could not verify the disposable browser account.');
    actor = users.data.users.find((user) => user.email === identity.email && user.user_metadata.crm_browser_qa === true)?.id ?? null;
    if (users.data.users.length < 100) break;
  }
  if (!actor) throw new Error('Disposable browser identity was not verified.');
  const membership = await admin.from('agency_members').insert({ user_id: actor, email: identity.email, role: 'agent', active: true });
  if (membership.error) throw new Error('Could not create the temporary verification membership.');
  const db = new PrismaClient({ datasources: { db: { url: database } } });
  const endpoint = '/api/social-marketing/drafts';
  const title = `Social verification ${randomUUID()}`;
  const touched: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) touched.push(new URL(request.url()).pathname); });
  try {
    await page.goto('/communication/social', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Social Marketing', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveAttribute('href', '/scheduler');
    await expect(page.getByRole('button', { name: 'Connected accounts', exact: true })).toBeVisible();
    await expect(page.getByText('Real social publishing is not available yet.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New draft', exact: true }).click();
    await page.getByLabel('Internal title', { exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('Coverage review\nAsk us about your options.');
    const createResponse = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    const created = await createResponse;
    expect(created.status(), await created.text()).toBe(201);
    const post = await created.json() as SocialDraft;
    expect(post.revision).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved (revision 1).' })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit draft', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue('Coverage review\nAsk us about your options.');
    await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('Updated public caption.');
    await expect(page.getByRole('complementary', { name: 'Post preview' })).toContainText('Updated public caption.');
    await page.getByRole('button', { name: 'Add image', exact: true }).click();
    await page.getByRole('button', { name: 'Upload image', exact: true }).click();
    const image = await sharp({ create: { width: 640, height: 480, channels: 4, background: { r: 20, g: 168, b: 216, alpha: 1 } } }).png().withMetadata().toBuffer();
    const imageInput = page.locator('input[type="file"][accept="image/jpeg,image/png"]');
    await imageInput.setInputFiles({ name: 'agency-image.png', mimeType: 'image/png', buffer: image });
    await expect.poll(() => imageInput.evaluate((input) => (input as HTMLInputElement).files?.length ?? 0)).toBe(1);
    await page.getByLabel('Image alt text', { exact: true }).fill('Agency-owned blue image');
    await page.getByLabel('Usage rights/source', { exact: true }).fill('Agency-owned test image');
    const uploadedResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/social-marketing/media') && response.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.getByRole('button', { name: 'Upload to library', exact: true }).click();
    const uploaded = await uploadedResponse;
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const media = await uploaded.json() as SocialMediaAsset;
    expect(media).toMatchObject({ status: 'ready', width: 640, height: 480, alt_text: 'Agency-owned blue image' });
    await expect(page.getByRole('img', { name: 'Attached draft image', exact: true })).toBeVisible();
    await expect.poll(() => page.getByRole('img', { name: 'Attached draft image', exact: true }).evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved (revision 2).' })).toBeVisible();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Request review', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Revision submitted for review.' })).toBeVisible();
    const agentApproval = await context.request.post('/api/social-marketing/reviews', {
      data: { id: post.id, action: 'approve', expected_revision: 2, expected_review_version: 1 },
    });
    expect(agentApproval.status()).toBe(403);
    const elevated = await admin.from('agency_members').update({ role: 'admin' }).eq('user_id', actor);
    if (elevated.error) throw new Error('Could not grant temporary reviewer permission.');
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Approve content', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Content approved. Nothing was scheduled or published.' })).toBeVisible();
    const demoted = await admin.from('agency_members').update({ role: 'agent' }).eq('user_id', actor);
    if (demoted.error) throw new Error('Could not restore disposable agent permission.');
    const stale = await context.request.post(endpoint, { data: { action: 'update', id: post.id, title, caption: 'Stale write', expected_revision: 1 } });
    expect(stale.status()).toBe(409);
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit draft', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByText('Revision history (latest 50)', { exact: true }).click();
    await expect(page.getByText('Coverage review\nAsk us about your options.', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue('Updated public caption.');
    await expect(page.getByRole('img', { name: 'Attached draft image', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Remove image from draft', exact: true }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved (revision 3).' })).toBeVisible();
    const removedDetail = await context.request.get(`${endpoint}?id=${post.id}`);
    const removedData = await removedDetail.json() as { post: SocialDraft; history: Array<{ revision: number; media_ids: string[] }> };
    expect(removedData.post.media_ids).toEqual([]);
    expect(removedData.post.review_state).toBe('not_submitted');
    expect(removedData.history.find((revision) => revision.revision === 2)?.media_ids).toEqual([media.id]);
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Add image', exact: true }).click();
    await page.getByRole('article').filter({ hasText: 'agency-image.png' }).getByRole('button', { name: 'Use image', exact: true }).click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved (revision 4).' })).toBeVisible();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByRole('article').filter({ has: page.getByRole('button', { name: title, exact: true }) }).getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('button', { name: 'Archive draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft archived.' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Draft status', exact: true }).selectOption('archived');
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Archived post', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toBeDisabled();
    const detailResponse = await context.request.get(`${endpoint}?id=${post.id}`);
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json() as { post: SocialDraft; history: unknown[] };
    expect(detail.post).toMatchObject({ status: 'archived', revision: 5, caption: 'Updated public caption.', media_ids: [media.id] });
    expect(detail.history).toHaveLength(5);
    const invalidImage = await context.request.post('/api/social-marketing/media', { multipart: {
      file: { name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an actual image') },
      alt_text: 'Invalid file', rights_reference: 'Agency-owned test',
    } });
    expect(invalidImage.status()).toBe(400);
    expect(touched.some((path) => path === '/api/events' || path.startsWith('/api/outreach/') || path.startsWith('/api/ai/'))).toBe(false);
    const revoked = await admin.from('agency_members').update({ active: false }).eq('user_id', actor);
    if (revoked.error) throw new Error('Could not revoke the temporary membership for authorization verification.');
    expect((await context.request.get(endpoint)).status()).toBe(403);
    expect((await context.request.get(`/api/social-marketing/media?id=${media.id}&variant=thumbnail`)).status()).toBe(403);
  } finally {
    try {
      const assets = await db.$queryRawUnsafe<Array<{ id: string; workspace_id: string }>>(
        "select m.id::text,m.workspace_id::text from public.social_media_assets m join auth.users u on u.id=m.created_by where u.id=$1::uuid and u.email=$2 and u.raw_user_meta_data->>'crm_browser_qa'='true'", actor, identity.email);
      if (assets.length) {
        const removed = await admin.storage.from(SOCIAL_MEDIA_BUCKET).remove(assets.flatMap((asset) =>
          [`${asset.workspace_id}/${asset.id}/image.jpg`, `${asset.workspace_id}/${asset.id}/thumbnail.jpg`]));
        if (removed.error) throw new Error('Could not clean up disposable test images from private storage.');
      }
      await db.$transaction(async (tx) => {
        const users = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "select id::text from auth.users where id=$1::uuid and email=$2 and raw_user_meta_data->>'crm_browser_qa'='true'", actor, identity.email);
        if (users.length !== 1) throw new Error('Refusing cleanup of an unverified auth identity.');
        await tx.$executeRawUnsafe('delete from public.social_review_events where post_id in (select id from public.social_posts where created_by=$1::uuid)', actor);
        await tx.$executeRawUnsafe('delete from public.social_revision_media where post_id in (select id from public.social_posts where created_by=$1::uuid)', actor);
        await tx.$executeRawUnsafe('delete from public.social_post_revisions where post_id in (select id from public.social_posts where created_by=$1::uuid)', actor);
        await tx.$executeRawUnsafe('delete from public.social_posts where created_by=$1::uuid', actor);
        await tx.$executeRawUnsafe('delete from public.social_media_assets where created_by=$1::uuid', actor);
        await tx.$executeRawUnsafe('delete from public.agency_members where user_id=$1::uuid', actor);
      }, { timeout: 60000, maxWait: 10000 });
    } finally { await db.$disconnect(); }
  }
});
