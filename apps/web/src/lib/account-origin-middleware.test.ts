import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { STAFF_WORKSPACE_HEADER } from './staff-workspace';

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser }, rpc }) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  vi.stubEnv('CRM_WEB_ORIGIN', '');
  vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
  getUser.mockReset().mockResolvedValue({ data: { user: null } });
  rpc.mockReset();
});

it('denies a signed-in nonmember and admits an active member even with the mailbox rollout off', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'member' } } });
  rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: true, error: null });
  rpc.mockResolvedValueOnce({ data: { mode: 'legacy' }, error: null });
  expect((await middleware(new NextRequest('http://localhost/settings'))).status).toBe(403);
  expect((await middleware(new NextRequest('http://localhost/settings'))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('agency_session_allowed');
});

it('routes content members to content and denies direct navigation to customer records', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'member' } } });
  rpc.mockImplementation(async (name: string) => ({
    error: null, data: name === 'agency_session_allowed' ? true : { mode: 'restricted', grants: { 'social.view': 'agency' } },
  }));
  const home = await middleware(new NextRequest('http://localhost/'));
  expect(home.headers.get('location')).toBe('http://localhost/communication/social');
  expect((await middleware(new NextRequest('http://localhost/clients/workspace'))).status).toBe(403);
  expect((await middleware(new NextRequest('http://localhost/communication/social'))).status).toBe(200);
});

it('derives staff navigation from verified access, never the incoming workspace header', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'member' } } });
  rpc.mockImplementation(async (name: string) => ({
    error: null, data: name === 'agency_session_allowed' ? true : { mode: 'restricted', grants: { 'social.view': 'agency' } },
  }));
  const headers = { [STAFF_WORKSPACE_HEADER]: 'full' };
  const response = await middleware(new NextRequest('http://localhost/communication/social', { headers }));
  expect(response.headers.get(`x-middleware-request-${STAFF_WORKSPACE_HEADER}`)).toBe('social-reader');
  const publicPage = await middleware(new NextRequest(`http://localhost/secure-intake/${'a'.repeat(43)}`, { headers }));
  expect(publicPage.headers.get(`x-middleware-request-${STAFF_WORKSPACE_HEADER}`)).toBeNull();
});

it('allows a same-origin JSON account request when Next normalizes the local hostname', async () => {
  const request = new NextRequest('http://localhost:3127/api/account', {
    method: 'PATCH',
    headers: { host: '127.0.0.1:3127', origin: 'http://127.0.0.1:3127', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: '{}',
  });
  expect((await middleware(request)).status).toBe(401);
});

it('allows signature image multipart uploads through the same-origin guard without bypassing authentication', async () => {
  const headers = { host: 'crm.example.invalid', origin: 'https://crm.example.invalid',
    'sec-fetch-site': 'same-origin', 'content-type': 'multipart/form-data; boundary=example' };
  const request = new NextRequest('https://crm.example.invalid/api/account/signature-image', {
    method: 'POST', headers, body: '--example--',
  });
  expect((await middleware(request)).status).toBe(401);
  expect((await middleware(new NextRequest('https://crm.example.invalid/api/account', {
    method: 'PATCH', headers, body: '--example--',
  }))).status).toBe(403);
});

it('rejects cross-origin signature image uploads before authentication', async () => {
  const request = new NextRequest('https://crm.example.invalid/api/account/signature-image', {
    method: 'POST', body: '--example--',
    headers: { origin: 'https://unrelated.example', 'sec-fetch-site': 'cross-site',
      'content-type': 'multipart/form-data; boundary=example' },
  });
  expect((await middleware(request)).status).toBe(403);
  expect(getUser).not.toHaveBeenCalled();
});

it.each([
  { origin: 'https://unrelated.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
  { origin: 'https://unrelated.example', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
  { origin: 'http://127.0.0.1:3127', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
])('rejects cross-origin and non-JSON account requests', async (headers) => {
  const request = new NextRequest('http://localhost:3127/api/account', {
    method: 'PATCH', headers: { host: '127.0.0.1:3127', ...headers }, body: '{}',
  });
  expect((await middleware(request)).status).toBe(403);
});

it('allows only the token-specific public questionnaire surface without opening staff endpoints', async () => {
  const token = 'a'.repeat(43);
  const page = await middleware(new NextRequest(`http://localhost/secure-intake/${token}`));
  expect(page.status).toBe(200);
  expect(page.headers.get('referrer-policy')).toBe('no-referrer');
  expect(page.headers.get('x-robots-tag')).toContain('noindex');
  expect((await middleware(new NextRequest(`http://localhost/api/questionnaire/${token}`))).status).toBe(200);
  expect((await middleware(new NextRequest('http://localhost/api/questionnaires'))).status).toBe(401);
  expect((await middleware(new NextRequest(`http://localhost/api/questionnaire/${token}/files`))).status).toBe(401);
});
