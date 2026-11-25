import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/personnel-documents/route';
import { GET as download } from '../app/api/personnel-documents/[id]/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const actor = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const file = '10000000-0000-4000-8000-000000000003';
const user: User = { id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' };
const post = (body: object) => new NextRequest('https://crm.example.invalid/api/personnel-documents', {
  method: 'POST', headers: { origin: 'https://crm.example.invalid', 'content-type': 'application/json' }, body: JSON.stringify(body),
});
let respond: (url: URL, init?: RequestInit) => Response;
const calls: URL[] = [];
beforeEach(() => {
  calls.length = 0;
  respond = () => Response.json(null);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url); return respond(url, init);
    } },
  }));
});
afterEach(() => vi.unstubAllEnvs());

it('denies document management without the separate personnel permission', async () => {
  respond = () => Response.json(false);
  const result = await POST(post({ action: 'ticket', member, file_name: 'agreement.pdf', file_size: 12, content_type: 'application/pdf' }));
  expect(result.status).toBe(403);
  expect(calls.map((url) => url.pathname)).toEqual(['/rest/v1/rpc/personnel_manager']);
});

it('registers a private upload before returning its signed URL', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  respond = (url, init) => {
    if (url.pathname.endsWith('/personnel_manager')) return Response.json(true);
    if (url.pathname.includes('/object/upload/sign/')) return Response.json({ url: '/object/upload/sign/test?token=test-token' });
    if (url.pathname.endsWith('/reserve_personnel_upload')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ p_actor: actor, p_member: member });
      return Response.json(null);
    }
    throw new Error('Unexpected request.');
  };
  const result = await POST(post({ action: 'ticket', member, file_name: 'agreement.pdf', file_size: 12, content_type: 'application/pdf' }));
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ signed_url: expect.stringContaining('token=test-token'), confirmation: expect.any(String) });
  expect(calls.map((url) => url.pathname)).toEqual([
    '/rest/v1/rpc/personnel_manager', expect.stringContaining('/object/upload/sign/'), '/rest/v1/rpc/reserve_personnel_upload',
  ]);
});

it('does not expose a signed upload URL if reservation fails', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  respond = (url) => {
    if (url.pathname.endsWith('/personnel_manager')) return Response.json(true);
    if (url.pathname.includes('/object/upload/sign/')) return Response.json({ url: '/object/upload/sign/test?token=test-token' });
    return Response.json({ code: '42501', message: 'Permission denied.' }, { status: 403 });
  };
  const result = await POST(post({ action: 'ticket', member, file_name: 'agreement.pdf', file_size: 12, content_type: 'application/pdf' }));
  expect(result.status).toBe(403);
  expect(JSON.stringify(await result.json())).not.toContain('test-token');
});

it('passes the signed-in actor and selected member to the scoped listing', async () => {
  respond = (url, init) => {
    if (url.pathname.endsWith('/personnel_manager')) return Response.json(false);
    expect(JSON.parse(String(init?.body))).toEqual({ p_actor: actor, p_member: member });
    return Response.json({ code: '42501', message: 'Personnel documents are unavailable.' }, { status: 403 });
  };
  const result = await GET(new NextRequest(`https://crm.example.invalid/api/personnel-documents?member=${member}`));
  expect(result.status).toBe(403);
});

it('streams only a document returned by the authorization function', async () => {
  respond = (url, init) => {
    if (url.pathname.endsWith('/read_personnel_document')) {
      expect(JSON.parse(String(init?.body))).toEqual({ p_actor: actor, p_id: file });
      return Response.json([{ member_id: actor, file_name: 'agreement.pdf', storage_path: `${actor}/${file}/document`,
        content_type: 'application/pdf', file_size: 3 }]);
    }
    return new Response('pdf');
  };
  const result = await download(new NextRequest(`https://crm.example.invalid/api/personnel-documents/${file}`), { params: Promise.resolve({ id: file }) });
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(result.headers.get('content-disposition')).toContain('attachment');
  expect(await result.text()).toBe('pdf');
});

it('does not request storage bytes when access to a document is denied', async () => {
  respond = () => Response.json([]);
  const result = await download(new NextRequest(`https://crm.example.invalid/api/personnel-documents/${file}`), { params: Promise.resolve({ id: file }) });
  expect(result.status).toBe(404);
  expect(calls).toHaveLength(1);
});

it('rejects cross-origin document mutations before checking authority', async () => {
  const request = new NextRequest('https://crm.example.invalid/api/personnel-documents', {
    method: 'POST', headers: { origin: 'https://other.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'share', id: file, version: 1 }),
  });
  expect((await POST(request)).status).toBe(403);
  expect(calls).toHaveLength(0);
});
