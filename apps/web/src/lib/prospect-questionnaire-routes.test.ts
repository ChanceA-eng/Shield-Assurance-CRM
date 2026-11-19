import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendResendEmail } from '@crm/shared/resend';
import { renderEmailHtml, emailDesignText } from '@crm/shared';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET, POST } from '../app/api/questionnaire/[token]/route';
import { POST as STAFF } from '../app/api/questionnaires/route';
import { prospectHash } from './prospect-questionnaire-server';
import { sendAgentEmail } from './agent-email';
import { resolveIntakeInvitationRecipient } from './message-delivery';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('@crm/shared/resend', async (importOriginal) => ({
  ...await importOriginal<typeof import('@crm/shared/resend')>(), sendResendEmail: vi.fn(), resendConfiguration: () => ({}),
}));
vi.mock('./agent-email', () => ({ sendAgentEmail: vi.fn() }));
vi.mock('./message-delivery', () => ({ resolveIntakeInvitationRecipient: vi.fn() }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c', token = 'a'.repeat(43);
const user: User = { id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const context = { params: Promise.resolve({ token }) };
let result: unknown;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const request = (body?: Record<string, unknown>, origin = 'http://localhost') => new NextRequest(`http://localhost/api/questionnaire/${token}`, body ? {
  method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ ...(body.action === 'challenge' ? { contact: { first_name: 'Synthetic', last_name: 'Prospect' } } : {}), ...body }),
} : undefined);
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0;
  vi.stubEnv('CRM_PROSPECT_REQUESTS_ENABLED', 'true');
  vi.stubEnv('CRM_PROSPECT_EMAIL_ENABLED', 'true');
  vi.stubEnv('CRM_PROSPECT_UPLOADS_ENABLED', 'false');
  vi.stubEnv('CRM_WEB_ORIGIN', '');
  vi.stubEnv('VERCEL', '');
  result = { verified: true };
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(sendResendEmail).mockResolvedValue({ providerId: 'synthetic-email' });
  vi.mocked(resolveIntakeInvitationRecipient).mockResolvedValue({ ok: true, recipient: { to: 'saved@example.invalid', leadId: id, clientId: null } });
  vi.mocked(sendAgentEmail).mockResolvedValue({ id, provider: 'gmail', status: 'accepted_by_provider' });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'synthetic-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      calls.push({ name: new URL(String(input)).pathname.split('/').pop() ?? '', args: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json(result);
    } },
  }));
});
afterEach(() => vi.unstubAllEnvs());
it('rejects invalid tokens, cross-origin writes and disabled uploads before touching request state', async () => {
  expect((await GET(request(), { params: Promise.resolve({ token: 'invalid' }) })).status).toBe(404);
  expect((await POST(request({ action: 'challenge' }, 'https://other.invalid'), context)).status).toBe(403);
  expect((await POST(request({ action: 'upload', question_id: id, name: 'id.pdf', size: 12 }), context)).status).toBe(503);
  expect(calls).toHaveLength(0);
});
it('sends verification only to the stored recipient and never returns the code or email', async () => {
  expect((await POST(request({ action: 'challenge', contact: { first_name: '', last_name: '' } }), context)).status).toBe(400);
  expect(calls).toHaveLength(0);
  result = { recipient: 'synthetic@example.invalid', id };
  const response = await POST(request({ action: 'challenge', recipient: 'attacker@example.invalid' }), context);
  expect(response.status).toBe(200);
  const sent = vi.mocked(sendResendEmail).mock.calls[0][0];
  expect(sent.to).toBe('synthetic@example.invalid');
  const code = sent.body.match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  const args = calls[0].args.p_data;
  expect(args).toEqual({ code_hash: prospectHash(`${token}:${code}`), network: prospectHash('local'), contact: { first_name: 'Synthetic', last_name: 'Prospect' } });
  expect(JSON.stringify(await response.json())).not.toContain(code);
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('commits durable rate limits before email and reports an explicit provider failure', async () => {
  result = { error: 'Too many code requests.', status: 429 };
  expect((await POST(request({ action: 'challenge' }), context)).status).toBe(429);
  expect(sendResendEmail).not.toHaveBeenCalled();
  result = { recipient: 'synthetic@example.invalid', id };
  vi.mocked(sendResendEmail).mockRejectedValue(new Error('Synthetic unavailable provider'));
  expect((await POST(request({ action: 'challenge' }), context)).status).toBe(503);
});
it('uses a hashed verification session and an HttpOnly scoped cookie', async () => {
  const response = await POST(request({ action: 'verify', code: '123456' }), context);
  const cookie = response.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain(`Path=/api/questionnaire/${token}`);
  expect(cookie).not.toMatch(/Max-Age|Expires=/i);
  const secret = cookie.split(';')[0].split('=')[1];
  expect(calls[0].args).toMatchObject({ p_hash: prospectHash(token), p_data: { code_hash: prospectHash(`${token}:123456`), new_session: prospectHash(secret) } });
  expect(await response.json()).toEqual({ verified: true });
});
it('keeps already-completed submission retries idempotent and blocks unsupported public actions', async () => {
  result = { submitted: true };
  expect(await (await POST(request({ action: 'submit', answers: {}, consent: true }), context)).json()).toEqual({ submitted: true });
  expect(calls).toHaveLength(1);
  expect((await POST(request({ action: 'reopen' }), context)).status).toBe(400);
});
it('requires a staff session and hashes generated link secrets before storage', async () => {
  vi.mocked(getApiSession).mockResolvedValueOnce({ user: null, error: NextResponse.json({ message: 'Sign in' }, { status: 401 }) });
  expect((await STAFF(request({ action: 'reopen', id }))).status).toBe(401);
  result = { id, state: 'open' };
  const response = await STAFF(request({ action: 'reopen', id }));
  const body = await response.json() as { path: string };
  const secret = body.path.split('/').pop()!;
  expect(calls[0].args).toMatchObject({ p_actor: id, p_action: 'reopen', p_data: { token_hash: prospectHash(secret) } });
  expect(JSON.stringify(calls[0].args)).not.toContain(secret);
});
it('sends an explicit invitation only to the scoped stored recipient with a stable provider attempt', async () => {
  vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
  result = { id, recipient: 'saved@example.invalid', recipient_name: 'Saved prospect', target_type: 'lead', target_id: id };
  const invitation = { action: 'invitation', id, token, request_id: id, email_provider: 'gmail', recipient: 'attacker@example.invalid' };
  expect((await STAFF(request(invitation))).status).toBe(200);
  expect(calls[0].args).toMatchObject({ p_action: 'invitation', p_data: { id, token_hash: prospectHash(token) } });
  expect(JSON.stringify(calls[0].args)).not.toContain(token);
  expect(sendAgentEmail).toHaveBeenCalledWith(expect.anything(), id,
    expect.objectContaining({ to: 'saved@example.invalid', purpose: 'service',
      emailDesign: expect.objectContaining({ button_url: `https://crm.example.invalid/secure-intake/${token}`, button_label: 'Open my secure form' }) }),
    { attemptId: id, leadId: id, clientId: null });
  expect(vi.mocked(sendAgentEmail).mock.calls[0][2].body).not.toContain('/secure-intake/');
  expect(sendResendEmail).not.toHaveBeenCalled();
  vi.clearAllMocks(); calls.length = 0;
  expect((await STAFF(request({ ...invitation, email_provider: 'default' }))).status).toBe(200);
  expect(sendResendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'saved@example.invalid', requestId: id, purpose: 'service' }), expect.anything());
  const message = vi.mocked(sendResendEmail).mock.calls[0][0];
  expect(message.body).not.toContain('/secure-intake/');
  expect(message.emailDesign).toMatchObject({ button_url: `https://crm.example.invalid/secure-intake/${token}` });
  const html = renderEmailHtml(message.body, message.emailDesign);
  expect(html.split(`/secure-intake/${token}`)).toHaveLength(2);
  expect(html).toContain('>Open my secure form</a>');
  expect(html).not.toContain(`>https://crm.example.invalid/secure-intake/${token}</a>`);
  expect(emailDesignText(message.body, message.emailDesign)).toContain(`Open my secure form: https://crm.example.invalid/secure-intake/${token}`);
  expect(calls.some((call) => call.name === 'communication_log')).toBe(true);
});
it('blocks invitation sends when the link is stale or recipient consent is absent', async () => {
  const invitation = { action: 'invitation', id, token, request_id: id, email_provider: 'gmail' };
  result = { error: 'This link is closed.', status: 409 };
  expect((await STAFF(request(invitation))).status).toBe(409);
  result = { id, recipient: 'saved@example.invalid', recipient_name: 'Saved prospect', target_type: 'lead', target_id: id };
  vi.mocked(resolveIntakeInvitationRecipient).mockResolvedValueOnce({ ok: false, status: 403, code: 'no_email_consent', message: 'Record email consent first.' });
  expect((await STAFF(request(invitation))).status).toBe(403);
  expect(resolveIntakeInvitationRecipient).toHaveBeenLastCalledWith(expect.anything(), { to: 'saved@example.invalid', leadId: id, clientId: null });
  expect(sendAgentEmail).not.toHaveBeenCalled();
  expect(sendResendEmail).not.toHaveBeenCalled();
});
