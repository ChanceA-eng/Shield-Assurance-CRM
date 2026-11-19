import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { GET, POST } from '../app/api/social-marketing/media/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const id = '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d';
const actor = '04865539-8320-4031-93de-8047f715f748';
const workspace = '62120357-eaef-42e9-a5c9-c52794c42808';
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const asset = { id, workspace_id: workspace, file_name: 'photo.png', alt_text: 'Building', rights_reference: 'Agency-owned',
  created_by: actor, status: 'processing', width: null, height: null, byte_size: null };
const calls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
let deny = false;
let storageFailure = false;
let completeFailure = false;
let persistedStatus = 'processing';
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
async function upload(bytes?: Buffer): Promise<NextRequest> {
  const png = bytes ?? await sharp({ create: { width: 64, height: 48, channels: 3, background: 'white' } }).png().toBuffer();
  const form = new FormData();
  form.set('file', new File([new Uint8Array(png)], 'photo.png', { type: 'image/png' }));
  form.set('alt_text', 'Building'); form.set('rights_reference', 'Agency-owned');
  return new NextRequest('https://crm.invalid/api/social-marketing/media', { method: 'POST', body: form });
}
beforeEach(() => {
  deny = false; storageFailure = false; completeFailure = false; persistedStatus = 'processing'; calls.length = 0;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && url.pathname.includes('/rest/') ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, method, body });
    if (url.pathname.endsWith('/list_social_media')) {
      return deny ? json({ code: '42501', message: 'Active agency membership is required.' }, 403)
        : json(body?.p_id ? { ...asset, status: 'ready' } : { assets: [], total: 0 });
    }
    if (url.pathname.endsWith('/reserve_social_media')) return json(asset);
    if (url.pathname.endsWith('/complete_social_media')) return completeFailure
      ? json({ code: 'XX000', message: 'database confirmation lost' }, 500) : json({ ...asset, status: 'ready', width: 64, height: 48 });
    if (url.pathname.endsWith('/fail_social_media')) return json(null);
    if (url.pathname.endsWith('/social_media_assets')) return json({ status: persistedStatus });
    if (url.pathname.includes('/storage/v1/object/sign/')) return json({ signedURL: '/object/sign/social-marketing-media/photo.jpg?token=test' });
    if (url.pathname.includes('/storage/v1/object/')) {
      return storageFailure && method === 'POST' ? json({ error: 'Storage down', statusCode: '503', message: 'Storage down' }, 503) : json({ Key: 'image', Id: id });
    }
    return json({ message: 'Unexpected test request' }, 500);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
});
describe('Social image routes', () => {
  it('requires a session before reading or uploading', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await GET(new NextRequest('https://crm.invalid/api/social-marketing/media'))).status).toBe(401);
    expect((await POST(await upload())).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('checks active workspace access before reading the upload body', async () => {
    deny = true;
    expect((await POST(new NextRequest('https://crm.invalid/api/social-marketing/media', { method: 'POST', body: 'invalid' }))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it('stores only sanitized JPEG variants under server-owned paths', async () => {
    const result = await POST(await upload());
    expect(result.status).toBe(201);
    const reservation = calls.find((call) => call.url.pathname.endsWith('/reserve_social_media'));
    expect(reservation?.body).toEqual({ p_actor: actor, p_file_name: 'photo.png', p_alt_text: 'Building', p_rights_reference: 'Agency-owned' });
    const writes = calls.filter((call) => call.url.pathname.includes('/storage/v1/object/') && call.method === 'POST');
    expect(writes.map((call) => call.url.pathname)).toEqual([
      `/storage/v1/object/social-marketing-media/${workspace}/${id}/image.jpg`,
      `/storage/v1/object/social-marketing-media/${workspace}/${id}/thumbnail.jpg`,
    ]);
    expect(calls.some((call) => call.url.pathname.endsWith('/complete_social_media'))).toBe(true);
    expect(calls.some((call) => call.url.pathname.endsWith('/fail_social_media'))).toBe(false);
  });
  it('records corrupt-image failure instead of accepting MIME or filename', async () => {
    const result = await POST(await upload(Buffer.from('not a PNG')));
    expect(result.status).toBe(400);
    expect(calls.some((call) => call.url.pathname.endsWith('/complete_social_media'))).toBe(false);
    expect(calls.find((call) => call.url.pathname.endsWith('/fail_social_media'))?.body).toMatchObject({ p_actor: actor, p_id: id });
  });
  it('cleans incomplete storage and persists failed status on storage error', async () => {
    storageFailure = true;
    expect((await POST(await upload())).status).toBe(503);
    expect(calls.some((call) => call.method === 'DELETE' && call.url.pathname.includes('/storage/'))).toBe(true);
    expect(calls.some((call) => call.url.pathname.endsWith('/fail_social_media'))).toBe(true);
  });
  it('never deletes ready media after an uncertain completion response', async () => {
    completeFailure = true; persistedStatus = 'ready';
    const result = await POST(await upload());
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ message: expect.stringContaining('Reload the library') });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(calls.some((call) => call.url.pathname.endsWith('/fail_social_media'))).toBe(false);
  });
  it('authorizes private previews before issuing a short-lived link', async () => {
    const result = await GET(new NextRequest(`https://crm.invalid/api/social-marketing/media?id=${id}&variant=thumbnail`));
    expect(result.status).toBe(307);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(calls[0].body?.p_actor).toBe(actor);
    expect(calls[1].url.pathname).toContain(`/${workspace}/${id}/thumbnail.jpg`);
    deny = true; calls.length = 0;
    expect((await GET(new NextRequest(`https://crm.invalid/api/social-marketing/media?id=${id}&variant=image`))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it.each(['?offset=-1', '?offset=2147483648', '?id=wrong', '?variant=image', `?id=${id}&variant=original`])
    ('rejects invalid media filters %s', async (query) => {
      expect((await GET(new NextRequest(`https://crm.invalid/api/social-marketing/media${query}`))).status).toBe(400);
      expect(calls).toHaveLength(0);
    });
});
