import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '../app/api/auth/team-setup/route';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const member = '44444444-4444-4444-8444-444444444444';
const challenge = 'a'.repeat(43);
const request = (body: object) => new NextRequest('https://crm.example.invalid/api/auth/team-setup', {
  method: 'POST', headers: { origin: 'https://crm.example.invalid', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

afterEach(() => vi.clearAllMocks());

it('issues a fresh short-lived provider proof only after the setup challenge is accepted', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/claim_team_setup')) {
      expect(JSON.parse(String(init?.body))).toEqual({ p_target: member, p_digest: createHash('sha256').update(challenge).digest('hex') });
      return Response.json('pending@example.test');
    }
    if (url.pathname.endsWith('/reserve_account_security')) return Response.json(true);
    if (url.pathname.endsWith('/generate_link')) return Response.json({ id: member, hashed_token: 'fresh-provider-proof' });
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }));
  const response = await POST(request({ member, challenge }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ token_hash: 'fresh-provider-proof' });
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    '/rest/v1/rpc/claim_team_setup', '/rest/v1/rpc/reserve_account_security', '/auth/v1/admin/generate_link',
  ]);
});

it('does not generate a provider proof for a rejected or malformed challenge', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: '42501', message: 'This setup link is expired.' }, { status: 403 }));
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }));
  expect((await POST(request({ member, challenge }))).status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await POST(request({ member, challenge: 'bad' }))).status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
