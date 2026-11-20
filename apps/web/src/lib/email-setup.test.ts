import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { emailConfigurationHash, emailConnectionStatus, completeReplyCheck, verifiedReplyCheck } from './email-setup';
import { GET, POST } from '../app/api/settings/email/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { sendOutboundEmail } from './email-adapter';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));

const actor = 'bb81a167-8e03-40f3-b6ac-1f239c691329';
const id = 'a53d5343-902d-4cbe-91d1-1abeec8907b9';
const user: User = { id: actor, email: 'owner@example.invalid', aud: 'authenticated', created_at: '', app_metadata: {}, user_metadata: {} };
interface Call { url: URL; method: string; body: Record<string, unknown> | null }
let calls: Call[];
let db: SupabaseClient;
let respond: (call: Call) => Response;
const teamAccess: { mode: 'restricted'; grants: Record<string, unknown> } = {
  mode: 'restricted', grants: { 'integrations.manage': 'agency' },
};
const json = (value: unknown, status = 200): Response => Response.json(value, { status });
const request = (body: unknown): NextRequest => new NextRequest('https://crm.example.invalid/api/settings/email', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  teamAccess.grants = { 'integrations.manage': 'agency' };
  for (const [key, value] of Object.entries({
    RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'sender@example.invalid', RESEND_REPLY_TO: 'owner@example.invalid',
    RESEND_INBOUND_ADDRESS: 'inbox@example.resend.app', RESEND_WEBHOOK_SECRET: 'test-secret',
    RESEND_SENDING_ENABLED: 'true', RESEND_REPLY_SYNC_READY: 'false',
    EMAIL_POSTAL_ADDRESS: '123 Test Street', EMAIL_UNSUBSCRIBE_SECRET: 'test-secret-with-more-than-32-characters',
    CRM_WEB_ORIGIN: 'https://crm.example.invalid', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-database-key',
  })) vi.stubEnv(key, value);
  calls = [];
  respond = (call) => {
    if (call.url.hostname === 'api.resend.com') return json({ data: [{ name: 'example.invalid', status: 'verified' }] });
    if (call.url.pathname.endsWith('/agency_members')) return json({ user_id: actor, email: user.email, role: 'owner', active: true });
    if (call.url.pathname.endsWith('/claim_email_setup_check')) return json({ id });
    return json(null);
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call); return respond(call);
  }));
  db = createClient('https://db.example.invalid', 'test-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
  vi.mocked(sendOutboundEmail).mockResolvedValue('resend');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('actionable email status', () => {
  it('checks the actual sending domain and keeps outbound/reply readiness distinct', async () => {
    expect(await emailConnectionStatus(db, actor)).toMatchObject({
      domainStatus: 'verified', sendingEnabled: true, replyReady: false, issues: [], latestTest: null,
    });
    expect(calls.some((call) => call.url.href === 'https://api.resend.com/domains')).toBe(true);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('names the deployment change instead of a generic setup warning', async () => {
    vi.stubEnv('RESEND_SENDING_ENABLED', 'false');
    expect((await emailConnectionStatus(db, actor)).issues).toContain('Requires deployment configuration: set RESEND_SENDING_ENABLED=true.');
  });
  it('checks actual tracking DNS separately from verified sending', async () => {
    const previous = respond;
    respond = (call) => {
      if (call.url.pathname === '/domains') return json({ data: [{ id, name: 'example.invalid', status: 'verified' }] });
      if (call.url.pathname === `/domains/${id}`) return json({
        open_tracking: true, records: [{ record: 'Tracking', name: 'links.example', value: 'links2.resend-dns.com', status: 'verified' }],
      });
      return previous(call);
    };
    expect(await emailConnectionStatus(db, actor)).toMatchObject({
      domainStatus: 'verified', openTracking: true, trackingStatus: 'verified',
      trackingRecord: { name: 'links.example', value: 'links2.resend-dns.com' },
    });
  });
  it('does not silently present tracking as disabled when its lookup fails', async () => {
    const previous = respond;
    respond = (call) => call.url.pathname === '/domains' ? json({ data: [{ id, name: 'example.invalid', status: 'verified' }] })
      : call.url.pathname === `/domains/${id}` ? json({}, 503) : previous(call);
    await expect(emailConnectionStatus(db, actor)).rejects.toThrow('Could not check email tracking');
  });
  it('does not present a provider failure as an unverified domain', async () => {
    const previous = respond;
    respond = (call) => call.url.hostname === 'api.resend.com' ? json({ message: 'Not authorized' }, 403) : previous(call);
    await expect(emailConnectionStatus(db, actor)).rejects.toThrow('Could not check Resend');
  });
  it('requires the integration grant before reading provider status or sending a test', async () => {
    teamAccess.grants = {};
    const previous = respond;
    respond = (call) => call.url.pathname.endsWith('/agency_members') ? json({ role: 'admin', active: true }) : previous(call);
    expect((await GET(new NextRequest('https://crm.example.invalid/api/settings/email'))).status).toBe(403);
    expect((await POST(request({ request_id: id }))).status).toBe(403);
    expect(calls.some((call) => call.url.hostname === 'api.resend.com')).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});

describe('self-test sending', () => {
  it('sends fixed content only to the signed-in owner and reuses a stable request key', async () => {
    const response = await POST(request({ request_id: id }));
    expect(response.status).toBe(200);
    expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: user.email, subject: `[CRM reply check ${id}]`, requestId: `email-setup:${id}`,
    }));
    expect(calls.find((call) => call.url.pathname.endsWith('/claim_email_setup_check'))?.body)
      .toEqual({ p_actor: actor, p_id: id, p_configuration_hash: emailConfigurationHash() });
  });
  it.each([{ request_id: id, to: 'someone@example.invalid' }, { request_id: 'invalid' }, { request_id: id, body: 'custom message' }])('rejects custom/invalid test input %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('does not create a send claim when sending is disabled', async () => {
    vi.stubEnv('RESEND_SENDING_ENABLED', 'false');
    expect((await POST(request({ request_id: id }))).status).toBe(503);
    expect(calls.some((call) => call.url.pathname.endsWith('/claim_email_setup_check'))).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('surfaces rate-limit and claim failures without contacting the provider', async () => {
    const previous = respond;
    respond = (call) => call.url.pathname.endsWith('/claim_email_setup_check') ? json({ code: '22023', message: 'Wait one minute before sending another test' }, 400) : previous(call);
    expect((await POST(request({ request_id: id }))).status).toBe(400);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});

describe('reply evidence', () => {
  function checkRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, expected_sender: user.email, configuration_hash: emailConfigurationHash(), expires_at: new Date(Date.now() + 3600000).toISOString(), verified_at: null, ...overrides };
  }
  it('unlocks only the current configuration after a matching owner reply', async () => {
    respond = () => json(checkRow());
    expect(await completeReplyCheck(db, { from: user.email ?? '', subject: `Re: [CRM reply check ${id}]`, providerId: actor })).toBe(true);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ inbound_provider_id: actor, verified_at: expect.any(String) });
  });
  it.each(['outbound-copy', 'expired', 'changed-config', 'already-verified'])('does not count %s as fresh reply proof', async (kind) => {
    respond = () => json(checkRow({
      ...(kind === 'expired' ? { expires_at: '2020-01-01T00:00:00Z' } : {}),
      ...(kind === 'changed-config' ? { configuration_hash: 'old' } : {}),
      ...(kind === 'already-verified' ? { verified_at: new Date().toISOString() } : {}),
    }));
    await completeReplyCheck(db, { from: kind === 'outbound-copy' ? 'sender@example.invalid' : user.email ?? '', subject: `Re: [CRM reply check ${id}]`, providerId: actor });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
  it('does not intercept normal contact replies', async () => {
    expect(await completeReplyCheck(db, { from: 'contact@example.invalid', subject: 'My insurance quote', providerId: actor })).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('does not query the database for a malformed check identity', async () => {
    expect(await completeReplyCheck(db, { from: 'contact@example.invalid', subject: `[CRM reply check ${'-'.repeat(36)}]`, providerId: actor })).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('invalidates verification when the reply destination changes', async () => {
    const previousHash = emailConfigurationHash();
    vi.stubEnv('RESEND_REPLY_TO', 'different@example.invalid');
    expect(emailConfigurationHash()).not.toBe(previousHash);
    await verifiedReplyCheck(db);
    expect(calls[0]?.url.searchParams.get('configuration_hash')).toBe(`eq.${emailConfigurationHash()}`);
  });
  it('does not silently unlock when proof lookup fails', async () => {
    respond = () => json({ code: 'XX000', message: 'unavailable' }, 500);
    await expect(verifiedReplyCheck(db)).rejects.toThrow('Something went wrong');
  });
});
