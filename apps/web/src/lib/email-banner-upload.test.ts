import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../app/api/sales-templates/banner/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const user: User = { id: '04865539-8320-4031-93de-8047f715f748', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-05T12:00:00Z' };
const fetcher = vi.fn<typeof fetch>();
let role: 'owner' | 'admin' | 'agent';
let stored: Array<{ url: URL; bytes: Buffer }>;

beforeEach(() => {
  role = 'owner';
  stored = [];
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'legacy' } });
  fetcher.mockReset();
  fetcher.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/agency_members') return Response.json({ user_id: user.id, active: true, role });
    expect(new Headers(init?.headers).get('content-type')).toBe('image/jpeg');
    expect(Buffer.isBuffer(init?.body)).toBe(true);
    if (Buffer.isBuffer(init?.body)) stored.push({ url, bytes: init.body });
    return Response.json({ Key: url.pathname, Id: 'asset' });
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
});

function upload(bytes: Buffer): NextRequest {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], 'test.png', { type: 'image/png' }));
  return new NextRequest('https://crm.example.invalid/api/sales-templates/banner', { method: 'POST', body });
}

it('stores a sanitized JPEG in the branding-only bucket and returns its recipient-accessible URL', async () => {
  const bytes = await sharp({ create: { width: 120, height: 45, channels: 3, background: '#14283b' } })
    .png().withMetadata({ orientation: 1 }).toBuffer();
  const response = await POST(upload(bytes));
  expect(response.status).toBe(201);
  expect(stored).toHaveLength(1);
  const [asset] = stored;
  expect(asset.url.pathname).toMatch(/^\/storage\/v1\/object\/email-branding-images\/[\da-f-]+\.jpg$/);
  expect(await response.json()).toEqual({ image_url: asset.url.href.replace('/object/', '/object/public/') });
  expect(await sharp(asset.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 120, height: 45 });
  expect((await sharp(asset.bytes).metadata()).exif).toBeUndefined();
});

it('rejects unauthorized users and files that are not decodable banners without writing to storage', async () => {
  role = 'agent';
  expect((await POST(upload(Buffer.from('not an image')))).status).toBe(403);
  role = 'admin';
  expect((await POST(upload(Buffer.from('not an image')))).status).toBe(400);
  expect(stored).toHaveLength(0);
});
