import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { requireAgencyOwner } from './agency-access';
import { agentSender } from './agency-membership';
import { getAgentEmailSender } from './agent-email-sender';
import { GET as account, PATCH as updateAccount } from '../app/api/account/route';
import { GET as settings, PATCH as updateSettings } from '../app/api/settings/outreach/route';
import { POST as invite, GET as agency, PUT as updateSender } from '../app/api/agency/route';
import { BUILT_IN_AUTOMATION_DEFAULTS, DEFAULT_OUTREACH_SENDER, documentFromText, type EmailDocument } from '@crm/shared';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), requireApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const userId = 'c5b14c2b-5527-4a2d-b395-e0a04a4f6dd2';
const user: User = { id: userId, email: 'account@example.invalid', aud: 'authenticated', created_at: '2026-11-01T00:00:00Z', app_metadata: {}, user_metadata: { full_name: 'Account user', role: 'owner' } };
interface Call { path: string; method: string; body: Record<string, unknown> | null; url: URL }
let calls: Call[];
let db: SupabaseClient;
let role: 'owner' | 'admin' | 'agent' | null;
let active: boolean;
let rpcError: boolean;
let personalSender: typeof DEFAULT_OUTREACH_SENDER;
let savedSenderProfiles: Array<typeof DEFAULT_OUTREACH_SENDER> | null;
let personalSignature: string;
let authLookupFails: boolean;
let signatureDesign: { document: EmailDocument } | null;
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (path: string, method = 'GET', body?: unknown): NextRequest => new NextRequest(`http://localhost${path}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
  calls = []; role = 'owner'; active = true; rpcError = false; personalSender = { ...DEFAULT_OUTREACH_SENDER }; savedSenderProfiles = null;
  personalSignature = ''; authLookupFails = false; signatureDesign = null;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: Call = { path: url.pathname, url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call);
    if (url.pathname.endsWith('/email_signature_designs')) return json(signatureDesign);
    if (url.pathname.endsWith('/agency_members')) {
      const member = role ? { user_id: userId, email: user.email, role, active, sender_profile: personalSender, gmail_ai_opt_in: false } : null;
      const rows = savedSenderProfiles?.map((sender_profile) => ({ sender_profile })) ?? (member ? [member] : []);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      return json(url.searchParams.has('user_id') ? member : rows.slice(offset, offset + limit));
    }
    if (url.pathname.endsWith('/outreach_settings')) return json({ id: 1, configuration_revision: 1, automation_configuration: BUILT_IN_AUTOMATION_DEFAULTS,
      approval_mode: true, daily_send_cap: 20, send_window_start: 8, send_window_end: 17, opt_out_footer: 'Test footer', sender_profile: DEFAULT_OUTREACH_SENDER });
    if (url.pathname.includes('/auth/v1/admin/users/')) {
      if (call.method === 'GET') return authLookupFails ? json({ message: 'Unavailable' }, 503) : json({ ...user, user_metadata: { ...user.user_metadata, signature: personalSignature } });
      return json({ ...user, user_metadata: call.body?.user_metadata });
    }
    if (url.pathname.endsWith('/rpc/save_agency_outreach_settings')) return rpcError ? json({ code: '42501', message: 'Only the agency owner can change agency settings' }, 403) : json(null);
    if (url.pathname.endsWith('/rpc/save_agency_outreach_settings_versioned')) return call.body?.p_expected_revision === 1
      ? json(2) : json({ code: 'PT409', message: 'Settings changed since you opened them. Reload before saving.' }, 409);
    return json([]);
  };
  db = createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
});

describe('personal account boundary', () => {
  it('uses membership, not user-editable metadata, for the access summary', async () => {
    role = 'agent';
    const response = await account(request('/api/account'));
    expect(await response.json()).toMatchObject({ role: 'agent', full_name: 'Account user', email: user.email });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(calls[0]?.url.searchParams.get('user_id')).toBe(`eq.${userId}`);
  });
  it('updates only the authenticated account', async () => {
    const response = await updateAccount(request('/api/account', 'PATCH', { full_name: ' Updated user ', contact_phone: ' 555-0100 ' }));
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: `/auth/v1/admin/users/${userId}`, body: { user_metadata: { full_name: 'Updated user', contact_phone: '555-0100' } },
    });
  });
  it.each(['user_id', 'role', 'email', 'app_metadata'])('rejects attempts to set %s through personal preferences', async (key) => {
    const response = await updateAccount(request('/api/account', 'PATCH', { full_name: 'User', contact_phone: '', [key]: 'other' }));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('rejects invalid names without updating auth', async () => {
    expect((await updateAccount(request('/api/account', 'PATCH', { full_name: ' ', contact_phone: '' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('requires authentication', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await account(request('/api/account'))).status).toBe(401);
    expect((await updateSettings(request('/api/settings/outreach', 'PATCH', {}))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('persists only the signed-in user signature without accepting role or sender changes', async () => {
    expect((await updateAccount(request('/api/account', 'PATCH', { signature: ' Jane Agent ' }))).status).toBe(200);
    expect(calls.find((call) => call.path.endsWith('/rpc/save_email_signature'))?.body).toEqual({
      p_actor: userId, p_text: 'Jane Agent', p_document: null, p_rows: null,
    });
    expect((await updateAccount(request('/api/account', 'PATCH', { signature: 'Jane', role: 'owner' }))).status).toBe(400);
    expect((await updateAccount(request('/api/account', 'PATCH', { signature: 'a'.repeat(2001) }))).status).toBe(400);
  });
  it('saves validated rich signatures through the actor-bound transaction and loads only the signed-in design', async () => {
    const signatureDocument = documentFromText('Jane');
    expect((await updateAccount(request('/api/account', 'PATCH', { signature: 'Jane', signatureDocument }))).status).toBe(200);
    expect(calls.find((call) => call.path.endsWith('/rpc/save_email_signature'))?.body).toMatchObject({
      p_actor: userId, p_text: 'Jane', p_document: signatureDocument, p_rows: null,
    });
    expect((await updateAccount(request('/api/account', 'PATCH', { signature: 'Different', signatureDocument }))).status).toBe(400);
    signatureDesign = { document: signatureDocument }; personalSignature = 'Jane';
    expect((await getAgentEmailSender(db, userId)).signatureDocument).toEqual(signatureDocument);
    expect(calls.find((call) => call.path.endsWith('/email_signature_designs'))?.url.searchParams.get('user_id')).toBe(`eq.${userId}`);
  });
  it('uses the saved personal signature for Gmail sender snapshots without altering the agency default', async () => {
    personalSignature = 'Jane Agent\nPersonal signature';
    const sender = await getAgentEmailSender(db, userId);
    expect(sender.signature).toBe(personalSignature);
    expect(sender.name).toBe(DEFAULT_OUTREACH_SENDER.name);
    expect(calls.find((call) => call.path.includes('/auth/v1/admin/users/'))?.path).toBe(`/auth/v1/admin/users/${userId}`);
    personalSignature = '   ';
    expect((await getAgentEmailSender(db, userId)).signature).toBe(DEFAULT_OUTREACH_SENDER.signature);
  });
  it('blocks Gmail sending if the personal signature cannot be read', async () => {
    authLookupFails = true;
    await expect(getAgentEmailSender(db, userId)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('signature could not be loaded') });
  });
  it('uses the personal signature with the agent profile in multi-agent mode', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true');
    personalSignature = 'Jane personal signature';
    const sender = await getAgentEmailSender(db, userId);
    expect(sender.signature).toBe(personalSignature);
    expect(sender.name).toBe(personalSender.name);
    personalSignature = '';
    expect((await getAgentEmailSender(db, userId)).signature).toBe(personalSender.signature);
  });
});

describe('owner-only agency configuration', () => {
  it('uses the versioned command and reports stale saves as conflicts', async () => {
    const response = await updateSettings(request('/api/settings/outreach', 'PATCH', { daily_send_cap: 25, expected_revision: 1 }));
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.path.endsWith('/save_agency_outreach_settings_versioned'))?.body).toMatchObject({
      p_expected_revision: 1, p_update: { daily_send_cap: 25 }, p_actor: userId,
    });
    expect((await updateSettings(request('/api/settings/outreach', 'PATCH', { daily_send_cap: 26, expected_revision: 2 }))).status).toBe(409);
  });
  it.each([null, 0, 1.5, '1', 2147483648])('rejects invalid revision %j without a settings write', async (revision) => {
    expect((await updateSettings(request('/api/settings/outreach', 'PATCH', { daily_send_cap: 25, expected_revision: revision }))).status).toBe(400);
    expect(calls.some((call) => call.path.includes('/rpc/'))).toBe(false);
  });
  it('loads saved suggestions beyond the first page', async () => {
    savedSenderProfiles = Array.from({ length: 101 }, (_, index) => ({ ...DEFAULT_OUTREACH_SENDER, name: `Producer ${index}`, role: `Saved job title ${index}` }));
    const response = await settings(request('/api/settings/outreach'));
    expect(response.status).toBe(200);
    const data = await response.json() as { sender_options: { name: string[]; role: string[] } };
    expect(data.sender_options.name).toContain('Producer 100');
    expect(data.sender_options.role).toContain('Saved job title 100');
    expect(calls.filter((call) => call.url.searchParams.get('select') === 'sender_profile')).toHaveLength(2);
  });
  it('loads saved sender suggestions without inventing roles or changing the sender', async () => {
    personalSender = { ...DEFAULT_OUTREACH_SENDER, role: 'Principal agent' };
    const response = await settings(request('/api/settings/outreach'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: { sender_profile: DEFAULT_OUTREACH_SENDER },
      sender_options: { name: ['Account user', 'Chance'], role: ['Insurance producer', 'Principal agent'] },
    });
    const suggestionQuery = calls.find((call) => call.path.endsWith('/agency_members') && !call.url.searchParams.has('user_id'));
    expect(suggestionQuery?.url.searchParams.get('active')).toBe('eq.true');
    expect(suggestionQuery?.url.searchParams.get('sender_profile')).toBe('not.is.null');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each(['admin', 'agent', null] as const)('rejects %s even with multi-agent mode disabled', async (value) => {
    role = value;
    await expect(requireAgencyOwner(db, userId)).rejects.toThrow('Only the agency owner');
    expect((await settings(request('/api/settings/outreach'))).status).toBe(403);
    expect((await updateSettings(request('/api/outreach', 'PATCH', { daily_send_cap: 25 }))).status).toBe(403);
    expect(calls.some((call) => call.path.includes('/rpc/'))).toBe(false);
  });
  it('rejects inactive owners', async () => {
    active = false;
    expect((await settings(request('/api/settings/outreach'))).status).toBe(403);
  });
  it('persists owner settings through the audited database command, not direct updates', async () => {
    const response = await updateSettings(request('/api/settings/outreach', 'PATCH', { daily_send_cap: 25 }));
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.path.endsWith('/rpc/save_agency_outreach_settings'))?.body).toEqual({ p_actor: userId, p_update: { daily_send_cap: 25 }, p_confirm_automatic: false });
    expect(calls.some((call) => call.path.endsWith('/outreach_settings') && call.method === 'PATCH')).toBe(false);
  });
  it.each([{ daily_send_cap: 201 }, { send_window_start: 18, send_window_end: 9 }, { approval_mode: 'false' }, { api_key: 'not-a-key' }])('rejects invalid agency updates %j', async (body) => {
    expect((await updateSettings(request('/api/settings/outreach', 'PATCH', body))).status).toBe(400);
    expect(calls.some((call) => call.path.includes('/rpc/'))).toBe(false);
  });
  it('surfaces a database authorization failure instead of reporting success', async () => {
    rpcError = true;
    expect((await updateSettings(request('/api/settings/outreach', 'PATCH', { daily_send_cap: 25 }))).status).toBe(403);
  });
  it('does not expose the team directory to an agent', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true'); role = 'agent';
    const response = await agency(request('/api/agency'));
    expect((await response.json()).members).toEqual([]);
    expect(calls.filter((call) => call.path.endsWith('/agency_members')).every((call) => call.url.searchParams.has('user_id'))).toBe(true);
  });
  it('does not let an admin invite agents without owner authority', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true'); role = 'admin';
    expect((await invite(request('/api/agency', 'POST', { email: 'invited@example.invalid' }))).status).toBe(403);
    expect(calls.some((call) => call.path.includes('/auth/'))).toBe(false);
  });
  it('prevents a personal profile from replacing agency-approved claims', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true'); role = 'agent';
    const response = await updateSender(request('/api/agency', 'PUT', {
      sender_profile: { ...DEFAULT_OUTREACH_SENDER, approved_claims: 'Unauthorized agency promise' }, gmail_ai_opt_in: false,
    }));
    expect(response.status).toBe(403);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
  it('uses current agency identity and approved claims while retaining the personal signature', async () => {
    personalSender = { ...DEFAULT_OUTREACH_SENDER, agency: 'Old agency', approved_claims: 'Outdated claim', signature: 'My personal signature' };
    expect(await agentSender(db, userId)).toMatchObject({
      agency: DEFAULT_OUTREACH_SENDER.agency, approved_claims: DEFAULT_OUTREACH_SENDER.approved_claims, signature: 'My personal signature',
    });
  });
});
