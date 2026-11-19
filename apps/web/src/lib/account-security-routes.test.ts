import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { createSupabaseServerAuthClient } from './supabase-auth-server';
import { reauthenticate } from './account-security';
import { sendAccountMail } from './account-mail';
import { POST as changeEmail } from '../app/api/account/email/route';
import { POST as confirm } from '../app/api/auth/confirm/route';
import { POST as recover } from '../app/api/auth/recovery/route';
import { GET as approvals, POST as decide } from '../app/api/settings/account-email/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./supabase-auth-server', () => ({ createSupabaseServerAuthClient: vi.fn() }));
vi.mock('./account-mail', () => ({ sendAccountMail: vi.fn() }));
vi.mock('./account-security', async (original) => ({ ...await original<typeof import('./account-security')>(), reauthenticate: vi.fn() }));

const user: User = { id: 'c5b14c2b-5527-4a2d-b395-e0a04a4f6dd2', email: 'old@example.invalid', aud: 'authenticated',
  created_at: '2026-11-01T00:00:00Z', user_metadata: { role: 'owner' }, app_metadata: {} };
const request = (path: string, body: unknown): NextRequest => new NextRequest(`https://crm.example.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
let role: string; let active: boolean; let complete: boolean; let recoveryMissing: boolean;
let calls: Array<{ path: string; body: Record<string, unknown> | null; method: string }>;
let db: SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
  role = 'agent'; active = true; complete = false; recoveryMissing = false; calls = [];
  db = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ path, body, method: init?.method ?? 'GET' });
      let data: unknown = null; let status = 200;
      if (path.endsWith('/agency_members')) data = { user_id: user.id, role, active };
      if (path.endsWith('/rpc/reserve_account_security')) data = true;
      if (path.endsWith('/rpc/request_account_email') || path.endsWith('/rpc/confirm_account_email')) data = 'request-id';
      if (path.endsWith('/account_email_changes')) data = { id: 'request-id', user_id: user.id, old_email: user.email,
        new_email: 'new@example.invalid', status: 'approved', expires_at: new Date(Date.now() + 3600000).toISOString(),
        old_confirmed_at: '2026-11-01', new_confirmed_at: complete ? '2026-11-01' : null };
      if (path.includes('/auth/v1/admin/users/')) data = { ...user, email: body?.email };
      if (path.endsWith('/auth/v1/admin/generate_link')) {
        data = recoveryMissing ? { code: 'user_not_found', msg: 'not found' } : { ...user,
          action_link: 'https://example.invalid', email_otp: '123456', hashed_token: 'a'.repeat(64), verification_type: 'recovery', redirect_to: '' };
        status = recoveryMissing ? 404 : 200;
      }
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
});
describe('verified own-account email changes', () => {
  it('reauthenticates and derives agent approval behavior from trusted membership', async () => {
    const response = await changeEmail(request('/api/account/email', { action: 'request', email: 'new@example.invalid', current_password: 'password' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('owner') });
    expect(reauthenticate).toHaveBeenCalledWith(db, user, 'password');
    expect(calls.find((call) => call.path.endsWith('/request_account_email'))?.body).toEqual({ p_actor: user.id, p_email: 'new@example.invalid' });
  });
  it('sends independent proofs to both addresses, retaining only hashes', async () => {
    expect((await changeEmail(request('/api/account/email', { action: 'verify', current_password: 'password' }))).status).toBe(200);
    const mail = vi.mocked(sendAccountMail).mock.calls;
    expect(mail.map((call) => call[0])).toEqual(['old@example.invalid', 'new@example.invalid']);
    expect(mail[0][3]).not.toBe(mail[1][3]);
    expect(mail[0][2]).toContain('/auth/confirm#type=email_change&token_hash=');
    const persisted = calls.find((call) => call.method === 'PATCH')?.body;
    expect(persisted?.old_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted?.old_token_hash).not.toBe(mail[0][3]);
    expect(persisted?.new_token_hash).not.toBe(mail[1][3]);
    expect(calls.some((call) => call.path.endsWith('generate_link'))).toBe(false);
  });
  it('cannot change email after only one confirmation', async () => {
    const response = await confirm(request('/api/auth/confirm', { type: 'email_change', token_hash: 'a'.repeat(64) }));
    expect(response.status).toBe(200);
    expect(calls.some((call) => call.path.includes('/auth/v1/admin/users/'))).toBe(false);
    expect(createSupabaseServerAuthClient).not.toHaveBeenCalled();
  });
  it('uses verified provider administration only after both proofs', async () => {
    complete = true;
    expect((await confirm(request('/api/auth/confirm', { type: 'email_change', token_hash: 'b'.repeat(64) }))).status).toBe(200);
    expect(calls.find((call) => call.path.includes('/auth/v1/admin/users/'))?.body).toEqual({ email: 'new@example.invalid', email_confirm: true });
  });
  it('blocks inactive members and non-owner approval access', async () => {
    active = false;
    expect((await changeEmail(request('/api/account/email', { action: 'request', email: 'new@example.invalid' }))).status).toBe(403);
    active = true; role = 'admin';
    expect((await approvals(request('/api/settings/account-email', {}))).status).toBe(403);
    expect((await decide(request('/api/settings/account-email', { id: 'request-id', approve: true }))).status).toBe(403);
  });
  it('propagates delivery failure instead of claiming verification was sent', async () => {
    vi.mocked(sendAccountMail).mockRejectedValueOnce(new Error('test delivery failure'));
    expect((await changeEmail(request('/api/account/email', { action: 'verify', current_password: 'password' }))).status).toBe(500);
  });
});
describe('public password recovery', () => {
  it('returns the same message for missing and valid accounts', async () => {
    const known = await recover(request('/api/auth/recovery', { email: 'old@example.invalid' }));
    recoveryMissing = true;
    const missing = await recover(request('/api/auth/recovery', { email: 'missing@example.invalid' }));
    expect(known.status).toBe(200); expect(missing.status).toBe(200);
    expect(await known.json()).toEqual(await missing.json());
    expect(sendAccountMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAccountMail).mock.calls[0][2]).toContain('/auth/confirm#type=recovery&token_hash=');
  });
  it('rejects invalid addresses before generating any token', async () => {
    expect((await recover(request('/api/auth/recovery', { email: 'not an address' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
