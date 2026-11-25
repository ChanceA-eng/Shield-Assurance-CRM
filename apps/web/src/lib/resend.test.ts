import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { sendResendEmail, type ResendConfiguration } from '@crm/shared/resend';
import { DEFAULT_EMAIL_DESIGN, documentFromText, type EmailDocument } from '@crm/shared';
import { sendOutboundEmail } from './email-adapter';
import { getSupabaseServerClient } from './supabase-server';
import { marketingEnvelope, readUnsubscribeToken, requireMarketingConsent, unsubscribeToken } from './marketing-email';
import { POST as eventHandler } from '../app/api/email/resend/route';
import { GET as unsubscribePage, POST as unsubscribe } from '../app/api/email/unsubscribe/route';
import { GET as delivery } from '../app/api/communication-log/delivery/route';
import { alertInboundMessage, ingestInboundMessage, resolveInboundSender } from './message-alerts';
import { handleInboundReply } from './outreach-engine';
import { getApiSession } from './api-auth';
import { POST as recordPermission } from '../app/api/email/consent/route';
import { POST as setupTest } from '../app/api/automation/email-test/route';
import { emailConfigurationHash } from './email-setup';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./message-alerts', async (original) => ({
  ...await original<typeof import('./message-alerts')>(),
  resolveInboundSender: vi.fn(), ingestInboundMessage: vi.fn(), alertInboundMessage: vi.fn(),
}));
vi.mock('./outreach-engine', () => ({ handleInboundReply: vi.fn() }));

const id = 'cf98e001-b31a-4fbc-9eba-31ac9215d439';
const providerId = '0265d773-333a-4fbb-b4f3-a96a40b4a195';
const config: ResendConfiguration = {
  apiKey: 'test-key', from: 'sender@example.invalid', replyTo: 'reply@example.invalid',
  enabled: 'true', databaseUrl: 'https://db.example.invalid', databaseKey: 'test-database-key',
};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const secret = `whsec_${Buffer.from('test-webhook-secret').toString('base64')}`;
let requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers; signal?: AbortSignal | null }>;
let respond: (url: string, body: Record<string, unknown>) => Response;
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'test-unsubscribe-secret-with-32-characters');
  vi.stubEnv('EMAIL_POSTAL_ADDRESS', '123 Test Street, Tucson, AZ 85701');
  vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
  requests = [];
  respond = (url) => {
    if (url.endsWith('begin_resend_send')) return json({ id, claimed: true });
    if (url === 'https://api.resend.com/emails') return json({ id: providerId });
    return json(null);
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    requests.push({ url, body, headers: new Headers(init?.headers), signal: init?.signal });
    return respond(url, body);
  }));
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    global: { fetch }, auth: { autoRefreshToken: false, persistSession: false },
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Resend transport', () => {
  it('blocks unresolved details in layout blocks before claiming or sending', async () => {
    const block = { color: '#263238', background: '#ffffff', padding: 0, border: 0, radius: 0, align: 'left' as const };
    const emailDesign = { ...DEFAULT_EMAIL_DESIGN, rows: [{ id: 'row', background: '#ffffff', columns: [[
      { ...block, id: 'body', type: 'body' as const },
      { ...block, id: 'text', type: 'text' as const, document: documentFromText('Hello {{contact_name}}') },
    ]] }] };
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Hello', body: 'Hello', emailDesign }, config))
      .rejects.toThrow('layout and signature');
    expect(requests).toHaveLength(0);
  });
  it('sends rich text and signature styles, binds them to retry identity, and rejects mismatched text before claiming', async () => {
    const bodyDocument: EmailDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
    ] }] };
    const input = { to: 'to@example.invalid', subject: 'Rich email', body: 'Hello\n\n-- \nJane',
      bodyDocument, signatureDocument: documentFromText('Jane') };
    await sendResendEmail(input, config);
    expect(requests[1]?.body.html).toContain('<strong>Hello</strong>');
    expect(requests[1]?.body.text).toBe('Hello\n\n-- \nJane');
    const firstHash = requests[0]?.body.p_hash;
    requests = [];
    await sendResendEmail({ ...input, bodyDocument: documentFromText('Hello') }, config);
    expect(requests[0]?.body.p_hash).not.toBe(firstHash);
    requests = [];
    await expect(sendResendEmail({ ...input, body: 'Other' }, config)).rejects.toThrow('no longer matches');
    expect(requests).toHaveLength(0);
  });
  it('sends the approved design with a plain-text button link', async () => {
    const emailDesign = { ...DEFAULT_EMAIL_DESIGN, heading: 'Welcome', button_label: 'View details', button_url: 'https://example.invalid/details' };
    await sendResendEmail({ to: 'to@example.invalid', subject: 'Welcome', body: 'Hello', emailDesign }, config);
    expect(requests[1]?.body.html).toContain('href="https://example.invalid/details"');
    expect(requests[1]?.body.text).toContain('View details: https://example.invalid/details');
  });
  it('records a claim before sending and saves a real provider receipt with attachments', async () => {
    expect(await sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Requested quote',
      attachments: [{ filename: 'quote.pdf', content: 'cGRm', type: 'application/pdf' }], requestId: 'stable-request' }, config))
      .toEqual({ providerId });
    expect(requests.map((request) => request.url)).toEqual([
      'https://db.example.invalid/rest/v1/rpc/begin_resend_send', 'https://api.resend.com/emails',
      'https://db.example.invalid/rest/v1/rpc/finish_resend_send',
    ]);
    expect(requests[1]?.headers.get('idempotency-key')).toBe(id);
    expect(requests[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(requests[1]?.body).toMatchObject({
      from: 'Shield Assurance <sender@example.invalid>', reply_to: 'reply@example.invalid',
      text: 'Requested quote', html: expect.stringContaining('Requested quote'), tags: [{ name: 'crm_attempt', value: id }],
      attachments: [{ filename: 'quote.pdf', content: 'cGRm', content_type: 'application/pdf' }],
    });
  });
  it('escapes message markup in the HTML alternative while preserving original text', async () => {
    await sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: '<script>unsafe()</script>\nA & B "quote"' }, config);
    expect(requests[1]?.body.html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;<br>A &amp; B &quot;quote&quot;');
    expect(requests[1]?.body.text).toBe('<script>unsafe()</script>\nA & B "quote"');
  });
  it('does not send when setup is incomplete', async () => {
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, { ...config, enabled: 'false' })).rejects.toThrow('not ready');
    expect(requests).toHaveLength(0);
  });
  it('surfaces provider rejection without retrying or recording false acceptance', async () => {
    respond = (url) => url.endsWith('begin_resend_send') ? json({ id, claimed: true }) : json({}, 429);
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config)).rejects.toThrow('did not confirm acceptance');
    expect(requests).toHaveLength(2);
    expect(requests.some((request) => request.url.endsWith('finish_resend_send'))).toBe(false);
  });
  it('keeps network timeouts ambiguous without another provider attempt', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('begin_resend_send')) return json({ id, claimed: true });
      throw new Error('network timeout');
    });
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config)).rejects.toThrow('did not confirm acceptance');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('has no provider fallback when Resend is unavailable', async () => {
    vi.stubEnv('RESEND_SENDING_ENABLED', 'false');
    await expect(sendOutboundEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' })).rejects.toThrow('not ready');
    expect(requests).toHaveLength(0);
  });
  it('keeps explicit authorized agent mailbox sending separate from the shared provider', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true');
    await expect(sendOutboundEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' })).rejects.toThrow('authorized mailbox');
    expect(requests).toHaveLength(0);
  });
  it('reuses durable acceptance without another provider call', async () => {
    respond = () => json({ id, claimed: false, status: 'accepted', provider_id: providerId });
    expect(await sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config)).toEqual({ providerId });
    expect(requests).toHaveLength(1);
  });
  it.each([false, true])('blocks an unresolved or invalid claim (%s)', async (invalid) => {
    respond = () => json(invalid ? {} : { id, claimed: false, status: 'sending' });
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('never sends when the safety database is unavailable', async () => {
    respond = () => json({ message: 'down' }, 503);
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config)).rejects.toThrow('safety checks');
    expect(requests).toHaveLength(1);
  });
  it('explains imported first-contact refusal without calling the provider', async () => {
    respond = () => json({ code: '42501', message: 'This imported contact has not requested email or given recorded permission.' }, 403);
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Hello', body: 'Hello' }, config))
      .rejects.toMatchObject({ code: 'send_blocked', status: 403, message: expect.stringContaining('no recorded email permission or prior request') });
    expect(requests).toHaveLength(1);
  });
  it('does not expose arbitrary database error details', async () => {
    respond = () => json({ code: 'XX000', message: 'private database detail' }, 500);
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Hello', body: 'Hello' }, config))
      .rejects.toMatchObject({ code: 'send_check_failed', status: 503, message: expect.not.stringContaining('private database detail') });
    expect(requests).toHaveLength(1);
  });
  it('reports a failed pre-send connection as unsent without calling Resend', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection failed'));
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Hello', body: 'Hello' }, config))
      .rejects.toMatchObject({ code: 'send_check_failed', message: expect.stringContaining('Nothing was sent') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not label accepted email unsent when receipt saving times out', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('finish_resend_send')) throw new Error('connection failed');
      return url.endsWith('begin_resend_send') ? json({ id, claimed: true }) : json({ id: providerId });
    });
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Hello', body: 'Hello' }, config))
      .rejects.toMatchObject({ code: 'acceptance_unrecorded', message: expect.stringContaining('accepted by Resend') });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('does not report success when the provider receipt cannot be saved', async () => {
    respond = (url) => url.endsWith('begin_resend_send') ? json({ id, claimed: true })
      : url.endsWith('finish_resend_send') ? json({}, 503) : json({ id: providerId });
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Quote', body: 'Hello' }, config))
      .rejects.toMatchObject({ code: 'acceptance_unrecorded', message: expect.stringContaining('accepted by Resend') });
    expect(requests.filter((request) => request.url === 'https://api.resend.com/emails')).toHaveLength(1);
  });
  it('requires marketing unsubscribe headers before any provider or database call', async () => {
    await expect(sendResendEmail({ to: 'to@example.invalid', subject: 'Offer', body: 'Offer', purpose: 'marketing' }, config)).rejects.toThrow('unsubscribe');
    expect(requests).toHaveLength(0);
  });
});

describe('Resend setup test', () => {
  const request = (body: Record<string, unknown> = {}): NextRequest => new NextRequest('https://crm.example.invalid/api/automation/email-test', {
    method: 'POST', body: JSON.stringify(body),
  });
  it('requires a verified session before sending a setup message', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await setupTest(request())).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it('rejects sending a setup message to someone other than the signed-in user', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(getApiSession).mockResolvedValue({ error: null, user: {
      id, email: 'admin@example.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    }, teamAccess: { mode: 'restricted', grants: { 'automation.manage': 'agency' } } });
    expect((await setupTest(request({ to: 'someone@example.invalid' }))).status).toBe(400);
    expect(requests).toHaveLength(0);
  });
  it('uses the durable Resend adapter with a fixed message and stable request identity', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('RESEND_FROM_EMAIL', 'sender@example.invalid');
    vi.stubEnv('RESEND_REPLY_TO', 'reply@example.invalid'); vi.stubEnv('RESEND_SENDING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.mocked(getApiSession).mockResolvedValue({ error: null, user: {
      id, email: 'admin@example.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    }, teamAccess: { mode: 'restricted', grants: { 'automation.manage': 'agency' } } });
    const result = await setupTest(request({ request_id: 'setup:one', subject: 'Must not use arbitrary content' }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ provider: 'resend', delivery: 'accepted_by_provider' });
    expect(requests[0]?.body.p_request_key).toBe('setup:one');
    expect(requests[1]?.body).toMatchObject({ to: ['admin@example.invalid'], subject: 'Shield CRM test email' });
  });
});

describe('marketing permission and unsubscribe', () => {
  it('requires authentication before accepting administrative permission records', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await recordPermission(new NextRequest('https://crm.example.invalid/api/email/consent', { method: 'POST' }))).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it('records who attested actual permission and refuses to override an unsubscribe', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(getApiSession).mockResolvedValue({ error: null, user: {
      id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    } });
    respond = (url) => url.includes('outreach_opt_outs') ? json(null) : json({});
    const request = (): NextRequest => new NextRequest('https://crm.example.invalid/api/email/consent', {
      method: 'POST', body: JSON.stringify({ email: 'to@example.invalid', source: 'Recipient gave written opt-in on November 3.', granted: true }),
    });
    expect((await recordPermission(request())).status).toBe(200);
    expect(requests.at(-1)?.body).toMatchObject({ recorded_by_auth: id, email: 'to@example.invalid', revoked_at: null });
    requests = [];
    respond = () => json({ email: 'to@example.invalid' });
    expect((await recordPermission(request())).status).toBe(409);
    expect(requests).toHaveLength(1);
  });
  it('signs links, rejects tampering and puts matching one-click headers in marketing email', () => {
    const token = unsubscribeToken('To@Example.invalid');
    expect(readUnsubscribeToken(token)).toBe('to@example.invalid');
    expect(() => readUnsubscribeToken(`${token}broken`)).toThrow('not valid');
    const envelope = marketingEnvelope('to@example.invalid', 'Offer');
    expect(envelope.body).toContain('123 Test Street');
    expect(envelope.body).toContain('/api/email/unsubscribe?token=');
    expect(envelope.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
  it('does not treat absent marketing permission as consent', async () => {
    respond = () => json(null);
    const db = getSupabaseServerClient();
    if (!db) throw new Error('test database required');
    await expect(requireMarketingConsent(db, 'to@example.invalid')).rejects.toThrow('permission');
  });
  it('GET does not unsubscribe; signed POST calls the atomic stop function', async () => {
    const url = `https://crm.example.invalid/api/email/unsubscribe?token=${unsubscribeToken('to@example.invalid')}`;
    expect((await unsubscribePage(new NextRequest(url))).status).toBe(200);
    expect(requests).toHaveLength(0);
    expect((await unsubscribe(new NextRequest(url, { method: 'POST' }))).status).toBe(200);
    expect(requests[0]?.url).toContain('unsubscribe_marketing_email');
    expect(requests[0]?.body).toEqual({ p_email: 'to@example.invalid' });
  });
  it('rejects invalid unsubscribe links without changing any record', async () => {
    expect((await unsubscribe(new NextRequest('https://crm.example.invalid/api/email/unsubscribe?token=forged', { method: 'POST' }))).status).toBe(400);
    expect(requests).toHaveLength(0);
  });
});

function signedEvent(type: string, timestamp = new Date()): NextRequest {
  const raw = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: providerId, tags: { crm_attempt: id } } });
  return new NextRequest('https://crm.example.invalid/api/email/resend', {
    method: 'POST', body: raw,
    headers: { 'svix-id': 'msg_test', 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': new Webhook(secret).sign('msg_test', timestamp, raw) },
  });
}
describe('Resend feedback', () => {
  it('verifies a setup reply only through a signed receiving event and does not create contact activity', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret); vi.stubEnv('RESEND_API_KEY', 'test');
    vi.stubEnv('RESEND_INBOUND_ADDRESS', 'inbox@example.resend.app');
    respond = (url) => {
      if (url.includes('/emails/receiving/')) return json({
        from: 'owner@example.invalid', to: ['inbox@example.resend.app'], subject: `Re: [CRM reply check ${id}]`, text: 'Reply check',
      });
      if (url.includes('/email_setup_checks?')) return json({
        id, expected_sender: 'owner@example.invalid', configuration_hash: emailConfigurationHash(),
        expires_at: new Date(Date.now() + 3600000).toISOString(), verified_at: null,
      });
      return json(null);
    };
    expect((await eventHandler(signedEvent('email.received'))).status).toBe(200);
    expect(requests.some((entry) => entry.body.inbound_provider_id === providerId)).toBe(true);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
    expect(handleInboundReply).not.toHaveBeenCalled();
  });
  it('rejects unsigned, stale and unconfigured webhooks', async () => {
    expect((await eventHandler(signedEvent('email.delivered'))).status).toBe(503);
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    expect((await eventHandler(new NextRequest('https://crm.example.invalid/api/email/resend', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await eventHandler(signedEvent('email.delivered', new Date(Date.now() - 600000)))).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it('passes verified delivery receipts and stable event identities to the atomic recorder', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    expect((await eventHandler(signedEvent('email.complained'))).status).toBe(200);
    expect(requests[0]?.body).toMatchObject({ p_event_id: 'msg_test', p_provider_id: providerId, p_type: 'email.complained', p_attempt_id: id });
  });
  it('records only signed provider open events without creating client activity or reply tasks', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    expect((await eventHandler(signedEvent('email.opened'))).status).toBe(200);
    expect(requests[0]?.body).toMatchObject({ p_event_id: 'msg_test', p_type: 'email.opened', p_provider_id: providerId });
    expect(ingestInboundMessage).not.toHaveBeenCalled();
    expect(alertInboundMessage).not.toHaveBeenCalled();
  });
  it('retrieves HTML-only replies as plain text, stops sequences and raises an inbox alert', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret); vi.stubEnv('RESEND_API_KEY', 'test');
    vi.stubEnv('RESEND_INBOUND_ADDRESS', 'inbox@example.resend.app');
    respond = () => json({ from: 'Lead <to@example.invalid>', to: ['inbox@example.resend.app'], subject: 'Question',
      html: '<p>Please call</p><script>doNotRun()</script>', created_at: new Date().toISOString() });
    vi.mocked(resolveInboundSender).mockResolvedValue({ clientId: null, leadId: id, name: 'Lead' });
    vi.mocked(ingestInboundMessage).mockResolvedValue({ id, client_id: null, channel: 'email', direction: 'inbound', subject: 'Question', sent_at: new Date().toISOString() });
    expect((await eventHandler(signedEvent('email.received'))).status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: 'Please call\n\n', providerId }));
    expect(handleInboundReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fromEmail: 'to@example.invalid', logId: id }));
    expect(alertInboundMessage).toHaveBeenCalledTimes(1);
  });
  it('returns a retryable failure and reuses reply identity when alert persistence fails', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret); vi.stubEnv('RESEND_RECEIVING_API_KEY', 'test');
    vi.stubEnv('RESEND_INBOUND_ADDRESS', 'inbox@example.resend.app');
    respond = () => json({ from: 'to@example.invalid', to: ['inbox@example.resend.app'], text: 'Stop sending', subject: 'Reply' });
    vi.mocked(resolveInboundSender).mockResolvedValue({ clientId: null, leadId: id, name: 'Lead' });
    vi.mocked(ingestInboundMessage).mockResolvedValue({ id, client_id: null, channel: 'email', direction: 'inbound', subject: 'Reply', sent_at: new Date().toISOString() });
    vi.mocked(alertInboundMessage).mockRejectedValueOnce(new Error('Alert persistence unavailable')).mockResolvedValue({ taskCreated: true });
    expect((await eventHandler(signedEvent('email.received'))).status).toBe(500);
    expect((await eventHandler(signedEvent('email.received'))).status).toBe(200);
    const receipts = vi.mocked(ingestInboundMessage).mock.calls;
    expect(receipts[0]?.[1].eventKey).toBe(receipts[1]?.[1].eventKey);
    expect(handleInboundReply).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ logId: id }));
  });
  it('keeps bounced or complained status ahead of late sent/delivered events in the delivery panel', async () => {
    respond = () => json([{ id, provider_id: providerId, to_email: 'to@example.invalid', subject: 'Quote', status: 'accepted', created_at: '2026-11-03T00:00:00Z',
      resend_delivery_events: [{ type: 'email.complained', occurred_at: '2026-11-03T01:00:00Z' }, { type: 'email.sent', occurred_at: '2026-11-03T02:00:00Z' }] }]);
    const result = await delivery(new NextRequest('https://crm.example.invalid/api/communication-log/delivery?to_email=to@example.invalid'));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject([{ status: 'complained', msg_id: providerId }]);
  });
  it('returns exact request identity and real first/last opens without replacing delivery status', async () => {
    respond = () => json([{ id, request_key: 'manual-request', provider_id: providerId, status: 'accepted',
      created_at: '2026-11-05T00:00:00Z', resend_delivery_events: [
        { type: 'email.opened', occurred_at: '2026-11-05T02:00:00Z' },
        { type: 'email.delivered', occurred_at: '2026-11-05T00:01:00Z' },
        { type: 'email.opened', occurred_at: '2026-11-05T01:00:00Z' },
      ] }]);
    const result = await delivery(new NextRequest('https://crm.example.invalid/api/communication-log/delivery?to_email=to@example.invalid&offset=0'));
    expect(await result.json()).toMatchObject([{ request_key: 'manual-request', status: 'delivered',
      delivered_at: '2026-11-05T00:01:00Z', first_open_at: '2026-11-05T01:00:00Z', last_open_at: '2026-11-05T02:00:00Z' }]);
  });
});
