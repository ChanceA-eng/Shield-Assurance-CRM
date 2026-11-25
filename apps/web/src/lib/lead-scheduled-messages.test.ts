import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../app/api/leads/[id]/scheduled-messages/route';
import { getSupabaseServerClient } from './supabase-server';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { getOwnGmailConnection } from './gmail-provider';
import { processAgentScheduled } from './agent-scheduled';
import { sendAgentEmail } from './agent-email';
import { WorkspaceError } from './record-scope';
import { DEFAULT_EMAIL_DESIGN, SALES_TEMPLATES, documentFromText, parseEmailDocument } from '@crm/shared';
import { GET as processScheduled } from '../app/api/messages/process-scheduled/route';
import { sendOutboundEmail } from './email-adapter';
import { POST as scheduleConversation, GET as readConversation, DELETE as cancelConversation } from '../app/api/communication/scheduled/route';
import { POST as scheduleAccount, PATCH as editAccount, DELETE as cancelAccount } from '../app/api/scheduled-messages/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(async () => ({
  user: { id: '11111111-1111-4111-8111-111111111111' }, error: null, teamAccess: { mode: 'restricted', grants },
})) }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({
  activeAgencyMember: vi.fn().mockResolvedValue({ role: 'agent', active: true }),
  agencyEnabled: () => process.env.CRM_MULTI_AGENT_ENABLED === 'true',
  agentSender: vi.fn().mockResolvedValue({ name: 'Synthetic sender' }),
}));
vi.mock('./message-delivery', () => ({ resolveOutboundEmailRecipient: vi.fn(),
  SMS_UNAVAILABLE: { status: 422, message: 'SMS provider not connected.' } }));
vi.mock('./gmail-provider', () => ({ getOwnGmailConnection: vi.fn() }));
vi.mock('./marketing-profile', async (original) => ({
  ...await original<typeof import('./marketing-profile')>(),
  getOutreachSender: vi.fn().mockResolvedValue({ name: 'Synthetic sender' }),
}));
vi.mock('./agent-email', () => ({ sendAgentEmail: vi.fn() }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));
vi.mock('./automation-health', () => ({
  trackedAutomation: vi.fn(async (_db: unknown, _job: string, run: () => Promise<unknown>) => run()),
}));
const lead = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const requestId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const mailbox = {
  id: 'mailbox', user_id: '11111111-1111-4111-8111-111111111111', email: 'agent@example.test', status: 'connected' as const,
  sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: true, history_id: null,
};
let owner = '11111111-1111-4111-8111-111111111111', archived = false, claimed = true;
let grants: Record<string, string>;
let stored: Record<string, unknown> | null;
let dispatchAllowed: boolean;
let dispatchCalls: Array<Record<string, unknown> | null>;
let calls: Array<{ method: string; body: Record<string, unknown> | null }>;
let queries: URL[];
let salesTemplates: unknown[];
const input = () => ({ request_id: requestId, subject: 'Synthetic email', body: 'Synthetic draft',
  send_at: new Date(Date.now() + 86400000).toISOString() });
const context = { params: Promise.resolve({ id: lead }) };
const req = (method: string, body?: unknown) => new NextRequest(`http://localhost/api/leads/${lead}/scheduled-messages`,
  { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });

beforeEach(() => {
  vi.clearAllMocks(); stored = null; calls = []; queries = []; salesTemplates = []; owner = '11111111-1111-4111-8111-111111111111'; archived = false; claimed = true;
  grants = { 'messages.view': 'agency', 'messages.send': 'agency', 'leads.view': 'agency', 'accounts.view': 'agency' };
  dispatchAllowed = true; dispatchCalls = [];
  vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: true, recipient: { to: 'synthetic@example.test', leadId: lead, clientId: null } });
  vi.mocked(getOwnGmailConnection).mockResolvedValue(null);
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      const path = new URL(String(url));
      queries.push(path);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (path.pathname.endsWith('/rpc/team_scheduled_dispatch_allowed')) { dispatchCalls.push(body); return json(dispatchAllowed); }
      if (path.pathname.endsWith('/auth/v1/admin/users/11111111-1111-4111-8111-111111111111')) return json({ id: '11111111-1111-4111-8111-111111111111', user_metadata: {}, app_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' });
      if (path.pathname.endsWith('/leads')) return json({ id: lead, agent_user_id: owner, archived_at: archived ? '2026-01-01' : null });
      if (path.pathname.endsWith('/clients')) return json({ id: lead, agent_user_id: owner, email: 'synthetic@example.test', email_consent: true });
      if (path.pathname.endsWith('/agent_email_attempts')) return json(null);
      if (path.pathname.endsWith('/email_signature_designs')) return json(null);
      if (path.pathname.endsWith('/sales_templates')) return json(salesTemplates);
      if (path.pathname.endsWith('/communication_log') || path.pathname.endsWith('/notifications')) return json({ id: requestId });
      if (path.pathname.endsWith('/scheduled_messages')) {
        calls.push({ method, body });
        if (method === 'POST') { stored = body; return json(body); }
        if (method === 'PATCH') {
          if (body?.status === 'processing' && !claimed) return json(null);
          if (stored && body) stored = { ...stored, ...body };
          return json({ id: requestId });
        }
        if (path.searchParams.has('id')) return json(stored);
        const mailboxFilter = path.searchParams.get('gmail_connection_id');
        if (mailboxFilter === 'not.is.null' && !stored?.gmail_connection_id) return json([]);
        if (mailboxFilter === 'is.null' && stored?.gmail_connection_id) return json([]);
        if (path.searchParams.get('status') === 'eq.pending' && stored?.status && stored.status !== 'pending') return json([]);
        return json(stored ? [stored] : []);
      }
      return new Response('Unexpected request', { status: 500 });
    } },
  }));
});
afterEach(() => vi.unstubAllEnvs());

const conversationRequest = (key: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/communication/scheduled?conversation=${encodeURIComponent(key)}`,
    { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });

describe('scheduling across manual communications', () => {
  it('queues accounts with a recipient snapshot and exact retry identity', async () => {
    const body = input(), key = `client:${lead}`;
    expect((await scheduleConversation(conversationRequest(key, 'POST', body))).status).toBe(201);
    expect(stored).toMatchObject({ client_id: lead, agent_user_id: '11111111-1111-4111-8111-111111111111', approved_recipient: 'synthetic@example.test' });
    expect(stored).not.toHaveProperty('lead_id');
    expect(resolveOutboundEmailRecipient).toHaveBeenLastCalledWith(expect.anything(), { clientId: lead });
    expect((await scheduleConversation(conversationRequest(key, 'POST', body))).status).toBe(200);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect((await scheduleAccount(req('POST', { ...body, client_id: lead }))).status).toBe(200);
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('preserves unmatched email identity without creating a lead or account', async () => {
    const key = 'unmatched:synthetic@example.test', body = input();
    expect((await scheduleConversation(conversationRequest(key, 'POST', body))).status).toBe(201);
    expect(stored).toMatchObject({ approved_recipient: 'synthetic@example.test', agent_user_id: '11111111-1111-4111-8111-111111111111' });
    expect(stored).not.toHaveProperty('client_id');
    expect(stored).not.toHaveProperty('lead_id');
    expect(resolveOutboundEmailRecipient).toHaveBeenLastCalledWith(expect.anything(), { conversationKey: key });
    expect((await readConversation(conversationRequest(key, 'GET'))).status).toBe(200);
    expect((await cancelConversation(conversationRequest(key, 'DELETE', { id: requestId }))).status).toBe(200);
    const filter = queries.at(-1)?.searchParams;
    expect(filter?.get('client_id')).toBe('is.null');
    expect(filter?.get('lead_id')).toBe('is.null');
    expect(filter?.get('status')).toBe('eq.pending');
    expect(filter?.get('agent_user_id')).toBe('eq.11111111-1111-4111-8111-111111111111');
    expect(filter?.get('approved_recipient')).toBe('eq.synthetic@example.test');
  });
  it('rejects SMS on every scheduling entry point without writing or sending', async () => {
    expect((await POST(req('POST', { ...input(), channel: 'sms' }), context)).status).toBe(422);
    expect((await scheduleConversation(conversationRequest(`client:${lead}`, 'POST', { ...input(), channel: 'sms' }))).status).toBe(422);
    expect((await scheduleAccount(req('POST', { ...input(), client_id: lead, channel: 'sms' }))).status).toBe(422);
    expect((await editAccount(req('PATCH', { id: requestId, channel: 'sms' }))).status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('blocks invalid targets, past account times and another agent account', async () => {
    for (const key of ['unmatched:unknown', 'unmatched:5205550100', 'client:invalid', 'bad:invalid']) {
      expect((await scheduleConversation(conversationRequest(key, 'POST', input()))).status).toBe(400);
    }
    expect((await scheduleConversation(conversationRequest(`client:${lead}`, 'POST', { ...input(), send_at: '2020-01-01' }))).status).toBe(400);
    grants = { 'messages.view': 'assigned', 'messages.send': 'assigned', 'leads.view': 'assigned', 'accounts.view': 'assigned' };
    owner = 'other';
    expect((await scheduleConversation(conversationRequest(`client:${lead}`, 'POST', input()))).status).toBe(404);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
  it('only cancels or edits pending account rows with an atomic actor filter', async () => {
    expect((await editAccount(req('PATCH', { id: requestId, send_at: input().send_at, body: 'Edited' }))).status).toBe(200);
    expect(calls.at(-1)?.body).toMatchObject({ body: 'Edited', body_document: null });
    expect((await editAccount(req('PATCH', { id: requestId, body: 'Rich edit', body_document: documentFromText('Rich edit') }))).status).toBe(200);
    expect(calls.at(-1)?.body?.body_document).toEqual(documentFromText('Rich edit'));
    expect(queries.at(-1)?.searchParams.get('status')).toBe('eq.pending');
    expect(queries.at(-1)?.searchParams.get('or')).toContain('agent_user_id.eq.11111111-1111-4111-8111-111111111111');
    expect((await editAccount(req('PATCH', { id: requestId, body: 'Wrong', body_document: documentFromText('Other') }))).status).toBe(400);
    expect((await cancelAccount(req('DELETE', { id: requestId }))).status).toBe(200);
    expect(calls.at(-1)).toEqual({ method: 'PATCH', body: { status: 'cancelled' } });
    expect(queries.at(-1)?.searchParams.get('status')).toBe('eq.pending');
    expect((await editAccount(req('PATCH', { id: requestId, send_at: 'invalid' }))).status).toBe(400);
    expect((await editAccount(req('PATCH', { id: requestId, status: 'sent' }))).status).toBe(400);
  });
  it('delivers unmatched scheduled mail through the shared provider with recipient identity', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    stored = { id: requestId, lead_id: null, client_id: null, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      approved_recipient: 'synthetic@example.test', subject: 'Synthetic subject', body: 'Synthetic draft', automation_type: 'manual' };
    const response = await processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer synthetic-cron-secret' } }));
    expect(response.status).toBe(200);
    expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'synthetic@example.test', requestId: `scheduled:${requestId}` }));
    expect(resolveOutboundEmailRecipient).toHaveBeenCalledWith(expect.anything(), { conversationKey: 'unmatched:synthetic@example.test' });
  });
  it('blocks shared account delivery after the approved recipient changes', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    stored = { id: requestId, client_id: lead, channel: 'email', approved_recipient: 'old@example.test',
      subject: 'Synthetic subject', body: 'Synthetic draft', automation_type: 'manual' };
    const response = await processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer synthetic-cron-secret' } }));
    expect(response.status).toBe(207);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.body?.status === 'failed')).toBe(true);
  });
});

describe('lead scheduled email', () => {
  it('retains rich content through JSONB key reordering, exact retries, and Gmail dispatch', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const body = { ...input(), email_provider: 'gmail', body_document: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Synthetic draft', marks: [{ type: 'bold' }] }] },
    ] } };
    expect((await POST(req('POST', body), context)).status).toBe(201);
    stored = { ...stored!, body_document: { content: [{ content: [{ marks: [{ type: 'bold' }], text: 'Synthetic draft', type: 'text' }], type: 'paragraph' }], type: 'doc' } };
    expect((await POST(req('POST', body), context)).status).toBe(200);
    expect((await POST(req('POST', { ...body, body_document: documentFromText(body.body) }), context)).status).toBe(409);
    expect(await processAgentScheduled(getSupabaseServerClient()!)).toEqual({ sent: 1, blocked: 0 });
    expect(sendAgentEmail).toHaveBeenCalledWith(expect.anything(), mailbox.user_id,
      expect.objectContaining({ bodyDocument: parseEmailDocument(body.body_document) }), expect.anything(), expect.any(Function));
  });
  it('queues explicitly selected personal Gmail while multi-agent mode is off', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const body = { ...input(), email_provider: 'gmail' };
    expect((await POST(req('POST', body), context)).status).toBe(201);
    expect(stored).toMatchObject({ gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender' } });
    expect((await POST(req('POST', body), context)).status).toBe(200);
    expect((await POST(req('POST', { ...body, email_provider: 'resend' }), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('rejects an unknown provider and Gmail without a connected mailbox', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    expect((await POST(req('POST', { ...input(), email_provider: 'smtp' }), context)).status).toBe(400);
    expect((await POST(req('POST', { ...input(), email_provider: 'gmail' }), context)).status).toBe(409);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
  it('dispatches personal Gmail independently of the multi-agent flag', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    stored = { id: requestId, lead_id: lead, client_id: null, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', body: 'Synthetic draft' };
    const result = await processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer test-secret' } }));
    expect(result.status).toBe(200);
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('queues a lead-only message without sending or creating an account and reconciles exact retries', async () => {
    const body = input();
    expect((await POST(req('POST', body), context)).status).toBe(201);
    expect(stored).toMatchObject({ lead_id: lead, agent_user_id: '11111111-1111-4111-8111-111111111111', status: 'pending', approved_recipient: 'synthetic@example.test' });
    expect(stored).not.toHaveProperty('client_id');
    expect((await POST(req('POST', body), context)).status).toBe(200);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect((await POST(req('POST', { ...body, body: 'Changed' }), context)).status).toBe(409);
  });
  it('rejects invalid and past times, empty messages, unassigned access and archived leads', async () => {
    for (const change of [{ send_at: 'invalid' }, { send_at: '2020-01-01' }, { body: '' }, { request_id: 'invalid' }]) {
      expect((await POST(req('POST', { ...input(), ...change }), context)).status).toBe(400);
    }
    grants = { 'messages.view': 'assigned', 'messages.send': 'assigned', 'leads.view': 'assigned', 'accounts.view': 'assigned' };
    owner = 'other';
    expect((await GET(req('GET'), context)).status).toBe(404);
    owner = '11111111-1111-4111-8111-111111111111'; archived = true;
    expect((await POST(req('POST', input()), context)).status).toBe(409);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
  it('blocks opt-outs and missing own Gmail mailbox', async () => {
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: false, status: 403, code: 'opted_out', message: 'Recipient opted out.' });
    expect((await POST(req('POST', input()), context)).status).toBe(403);
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: true, recipient: { to: 'synthetic@example.test', leadId: lead, clientId: null } });
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true');
    expect((await POST(req('POST', input()), context)).status).toBe(409);
  });
  it('cancels a pending message with actor and lead-scoped filters', async () => {
    expect((await DELETE(req('DELETE', { id: requestId }), context)).status).toBe(200);
    expect(calls).toContainEqual({ method: 'PATCH', body: { status: 'cancelled' } });
  });
  it('claims once before Gmail sending and preserves the lead identity', async () => {
    stored = { id: requestId, lead_id: lead, client_id: null, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', body: 'Synthetic draft' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 1, blocked: 0 });
    expect(sendAgentEmail).toHaveBeenCalledWith(db, '11111111-1111-4111-8111-111111111111', expect.objectContaining({ to: 'synthetic@example.test' }),
      { attemptId: requestId, clientId: null, leadId: lead }, expect.any(Function));
    claimed = false;
    await processAgentScheduled(db);
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
  });
  it('blocks delivery if the approved recipient changes', async () => {
    stored = { id: requestId, lead_id: lead, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender' }, approved_recipient: 'old@example.test' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(calls).toContainEqual({ method: 'PATCH', body: { status: 'failed', last_error: expect.stringContaining('Recipient changed') } });
  });
  it('blocks a scheduled Gmail send when the approved signature changes', async () => {
    stored = { id: requestId, lead_id: lead, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender', signature: 'Old signature' },
      approved_recipient: 'synthetic@example.test' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(calls).toContainEqual({ method: 'PATCH', body: { status: 'failed', last_error: 'Sender profile or mailbox changed. Review and recreate this scheduled message.' } });
  });
  it('preserves the approved branded design through scheduling and Gmail processing', async () => {
    const design = { ...DEFAULT_EMAIL_DESIGN, heading: 'Welcome', button_label: 'View details', button_url: 'https://example.invalid/details' };
    const template = { ...SALES_TEMPLATES.find((item) => item.id === 'introduction')!, revision: 1, email_design: design };
    salesTemplates = [template];
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    const schedule = { ...input(), email_provider: 'gmail', sales_template: { id: template.id, revision: 1, email_design: design } };
    expect((await POST(req('POST', schedule), context)).status).toBe(201);
    expect(stored?.sales_template).toMatchObject({ email_design: design });
    expect((await POST(req('POST', { ...schedule, sales_template: { ...schedule.sales_template, email_design: { ...design, heading: 'Changed' } } }), context)).status).toBe(409);
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 1, blocked: 0 });
    expect(sendAgentEmail).toHaveBeenCalledWith(db, mailbox.user_id, expect.anything(),
      expect.objectContaining({ salesTemplate: expect.objectContaining({ email_design: design }) }), expect.any(Function));
  });
  it('does not deliver a claimed Gmail schedule after sending access is revoked', async () => {
    stored = { ...input(), id: requestId, lead_id: lead, agent_user_id: mailbox.user_id,
      gmail_connection_id: mailbox.id, approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', channel: 'email', status: 'pending' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    dispatchAllowed = false;
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(stored).toMatchObject({ status: 'failed', last_error: expect.stringContaining('no longer has permission') });
  });
  it('rechecks scheduled sending permission at the Gmail handoff', async () => {
    stored = { ...input(), id: requestId, lead_id: lead, agent_user_id: mailbox.user_id,
      gmail_connection_id: mailbox.id, approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', channel: 'email', status: 'pending' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    vi.mocked(sendAgentEmail).mockImplementationOnce(async (_db, _actor, _input, _options, beforeDispatch) => {
      dispatchAllowed = false;
      await beforeDispatch?.();
      return { id: requestId, provider: 'gmail', status: 'accepted_by_provider' };
    });
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(stored).toMatchObject({ status: 'failed', last_error: expect.stringContaining('no longer has permission') });
  });
  it('blocks a scheduled Gmail send when contact consent changes at the handoff', async () => {
    stored = { ...input(), id: requestId, lead_id: lead, agent_user_id: mailbox.user_id,
      gmail_connection_id: mailbox.id, approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', channel: 'email', status: 'pending' };
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    vi.mocked(sendAgentEmail).mockImplementationOnce(async (_db, _actor, _input, _options, beforeDispatch) => {
      vi.mocked(resolveOutboundEmailRecipient).mockResolvedValueOnce({ ok: false, status: 403, code: 'opted_out', message: 'Recipient opted out.' });
      await beforeDispatch?.();
      return { id: requestId, provider: 'gmail', status: 'accepted_by_provider' };
    });
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(stored).toMatchObject({ status: 'failed', last_error: 'Recipient opted out.' });
  });

  it('passes the current record to authorization for both shared and Gmail sends', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    for (const gmail of [false, true]) {
      stored = { ...input(), id: requestId, lead_id: lead, client_id: null, agent_user_id: mailbox.user_id,
        gmail_connection_id: gmail ? mailbox.id : null, approved_sender: { name: 'Synthetic sender' },
        approved_recipient: 'synthetic@example.test', channel: 'email', automation_type: 'manual', status: 'pending' };
      dispatchAllowed = false; queries = [];
      expect((await processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
        { headers: { authorization: 'Bearer test-secret' } }))).status).toBe(207);
      expect(queries.some((url) => url.pathname.endsWith('/rpc/team_scheduled_dispatch_allowed'))).toBe(true);
      expect(dispatchCalls.at(-1)).toEqual({ p_actor: mailbox.user_id, p_lead: lead, p_client: null });
      expect(stored?.status).toBe('failed');
    }
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('rechecks a deferred Gmail retry and preserves actorless agency automation', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    vi.mocked(sendAgentEmail).mockRejectedValueOnce(new WorkspaceError('Mailbox limit reached.', 429));
    stored = { ...input(), id: requestId, lead_id: lead, client_id: null, channel: 'email',
      agent_user_id: mailbox.user_id, gmail_connection_id: mailbox.id, approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', automation_type: 'manual', status: 'pending' };
    const db = getSupabaseServerClient()!;
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    dispatchAllowed = false;
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
    expect(stored?.status).toBe('failed');
    stored = { id: requestId, client_id: lead, lead_id: null, agent_user_id: null, gmail_connection_id: null,
      channel: 'email', automation_type: 'renewal', status: 'pending', body: 'Synthetic draft' };
    dispatchCalls = [];
    expect((await processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer test-secret' } }))).status).toBe(200);
    expect(dispatchCalls).toHaveLength(0);
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
  });

  it('defers a rate-limited Gmail schedule without creating another request', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(getOwnGmailConnection).mockResolvedValue(mailbox);
    vi.mocked(sendAgentEmail).mockRejectedValueOnce(new WorkspaceError('Mailbox limit reached.', 429));
    stored = { id: requestId, lead_id: lead, client_id: null, channel: 'email', agent_user_id: '11111111-1111-4111-8111-111111111111',
      gmail_connection_id: 'mailbox', approved_sender: { name: 'Synthetic sender' },
      approved_recipient: 'synthetic@example.test', body: 'Synthetic draft' };
    const db = getSupabaseServerClient();
    if (!db) throw new Error('Test database is required');
    expect(await processAgentScheduled(db)).toEqual({ sent: 0, blocked: 1 });
    expect(stored).toMatchObject({ status: 'pending', last_error: 'Mailbox limit reached.' });
    expect(Date.parse(String(stored?.send_at))).toBeGreaterThan(Date.now() + 14 * 60000);
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('sends a due lead-only email through the shared provider and does not reclaim it', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'test-secret');
    stored = { id: requestId, lead_id: lead, client_id: null, channel: 'email', automation_type: 'manual',
      approved_recipient: 'synthetic@example.test', body: 'Synthetic scheduled draft' };
    const cron = () => processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer test-secret' } }));
    expect((await cron()).status).toBe(200);
    expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({
      leadId: lead, to: 'synthetic@example.test', requestId: `scheduled:${requestId}`,
    }));
    claimed = false;
    await cron();
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
  });
  it('does not send a lead email through the shared provider when consent or recipient changes', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'test-secret');
    stored = { id: requestId, lead_id: lead, client_id: null, channel: 'email', approved_recipient: 'old@example.test' };
    const cron = () => processScheduled(new NextRequest('http://localhost/api/messages/process-scheduled',
      { headers: { authorization: 'Bearer test-secret' } }));
    expect((await cron()).status).toBe(207);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: false, status: 403, code: 'opted_out', message: 'Recipient opted out.' });
    stored = { ...stored, status: 'pending' };
    expect((await cron()).status).toBe(207);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});
