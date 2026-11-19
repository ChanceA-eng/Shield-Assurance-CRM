import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { agentMime, sendAgentEmail } from './agent-email';
import { gmailRequest, getOwnGmailConnection } from './gmail-provider';
import { agencyEnabled, agentSender } from './agency-membership';
import { getOutreachSender } from './marketing-profile';
import { DEFAULT_EMAIL_DESIGN, DEFAULT_OUTREACH_SENDER, documentFromText } from '@crm/shared';

vi.mock('./gmail-provider', () => ({ getOwnGmailConnection: vi.fn(), gmailRequest: vi.fn() }));
vi.mock('./agency-membership', () => ({ agencyEnabled: vi.fn(() => true), agentSender: vi.fn() }));
vi.mock('./marketing-profile', async (original) => ({ ...await original<typeof import('./marketing-profile')>(), getOutreachSender: vi.fn() }));
const user = '10000000-0000-4000-8000-000000000001';
const options = { attemptId: '10000000-0000-4000-8000-000000000002', clientId: '10000000-0000-4000-8000-000000000003', leadId: null };
const input = { to: 'client@example.invalid', subject: 'Review', body: 'Your requested review.' };
interface Call { name: string; method: string; body: Record<string, unknown> | null; url: URL }
let calls: Call[];
let respond: (call: Call) => Response;
let signature: string;
let db: SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; signature = '';
  vi.mocked(agencyEnabled).mockReturnValue(true);
  vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: 'mailbox1', user_id: user, email: 'taylor@example.invalid', status: 'connected', sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: true, history_id: '90071992547409999' });
  vi.mocked(agentSender).mockResolvedValue({ ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', signature: 'Taylor\nShield Assurance' });
  vi.mocked(gmailRequest).mockResolvedValue({ id: 'gmail1', threadId: 'thread1' });
  respond = (call) => Response.json(call.name === 'finalize_agent_email' ? 'communication1' : call.method === 'GET' ? (call.url.searchParams.has('to_email') ? [] : null) : null);
  db = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
      const parsed = new URL(String(url));
      const call: Call = { name: parsed.pathname.split('/').pop() ?? '', method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, url: parsed };
      calls.push(call);
      if (parsed.pathname.includes('/auth/v1/admin/users/')) return Response.json({ id: user, aud: 'authenticated', created_at: '2026-01-01', app_metadata: {}, user_metadata: { signature } });
      return respond(call);
    } },
  });
});
afterEach(() => vi.unstubAllEnvs());
it('claims before sending, signs as the authenticated agent, and records provider acceptance exactly once', async () => {
  expect(await sendAgentEmail(db, user, input, options)).toMatchObject({ id: 'communication1', provider: 'gmail', status: 'accepted_by_provider' });
  expect(calls.find((call) => call.method === 'POST' && call.name === 'agent_email_attempts')?.body).toMatchObject({ user_id: user, body: 'Your requested review.\n\n-- \nTaylor\nShield Assurance\nhttps://www.shield-assurance.com' });
  expect(gmailRequest).toHaveBeenCalledTimes(1);
  expect(calls.at(-1)?.name).toBe('finalize_agent_email');
  const last = vi.mocked(gmailRequest).mock.calls[0];
  const body: { raw: string } = JSON.parse(String(last?.[3]?.body));
  expect(Buffer.from(body.raw, 'base64url').toString()).toContain('<taylor@example.invalid>');
});
it('uses the saved personal signature when sending through personal Gmail', async () => {
  vi.mocked(agencyEnabled).mockReturnValue(false);
  vi.mocked(getOutreachSender).mockResolvedValue(DEFAULT_OUTREACH_SENDER);
  signature = 'My updated signature';
  await sendAgentEmail(db, user, input, options);
  expect(calls.find((call) => call.name === 'agent_email_attempts' && call.method === 'POST')?.body?.body)
    .toContain('-- \nMy updated signature');
  const sent = JSON.parse(String(vi.mocked(gmailRequest).mock.calls[0]?.[3]?.body)) as { raw: string };
  const mime = Buffer.from(sent.raw, 'base64url').toString();
  const plain = /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime)?.[1];
  expect(Buffer.from(plain ?? '', 'base64').toString()).toContain('My updated signature');
});
it('includes rich body and personal signature styles in Gmail and its durable formatting snapshot', async () => {
  const bodyDocument = documentFromText(input.body);
  const signatureDocument = { type: 'doc' as const, content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Taylor\nShield Assurance', marks: [{ type: 'bold' }] },
  ] }] };
  const original = respond;
  respond = call => call.name === 'email_signature_designs' ? Response.json({ document: signatureDocument }) : original(call);
  await sendAgentEmail(db, user, { ...input, bodyDocument }, options);
  expect(calls.find(call => call.name === 'agent_email_attempts' && call.method === 'POST')?.body?.email_formatting)
    .toMatchObject({ bodyDocument, signatureDocument });
  const sent = JSON.parse(String(vi.mocked(gmailRequest).mock.calls[0]?.[3]?.body)) as { raw: string };
  const mime = Buffer.from(sent.raw, 'base64url').toString();
  const html = /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime)?.[1];
  expect(Buffer.from(html ?? '', 'base64').toString()).toContain('<strong>Taylor\nShield Assurance</strong>');
});
it('sends the approved template design and rejects reuse of the request with different branding', async () => {
  const design = { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Example agency', heading: 'Welcome',
    button_label: 'See details', button_url: 'https://example.invalid/details' };
  const branded = { ...options, salesTemplate: { id: 'welcome', revision: 1, email_design: design } };
  await sendAgentEmail(db, user, input, branded);
  const sent = JSON.parse(String(vi.mocked(gmailRequest).mock.calls[0]?.[3]?.body)) as { raw: string };
  const mime = Buffer.from(sent.raw, 'base64url').toString();
  const part = mime.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1]!.split('\r\n--')[0]!;
  expect(Buffer.from(part, 'base64').toString()).toContain('href="https://example.invalid/details"');
  respond = () => Response.json({ id: options.attemptId, user_id: user, status: 'recorded', content_hash: 'different' });
  await expect(sendAgentEmail(db, user, input, { ...branded, salesTemplate: { ...branded.salesTemplate, email_design: { ...design, heading: 'Changed' } } })).rejects.toThrow('different sender or content');
  expect(gmailRequest).toHaveBeenCalledTimes(1);
});
it('does not contact Gmail without an own connected mailbox or stable request ID', async () => {
  await expect(sendAgentEmail(db, user, input, { ...options, attemptId: 'invalid' })).rejects.toThrow('stable send request');
  vi.mocked(getOwnGmailConnection).mockResolvedValue(null);
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('own Gmail');
  expect(gmailRequest).not.toHaveBeenCalled();
});
it('never sends again after ambiguous provider acceptance', async () => {
  vi.mocked(gmailRequest).mockRejectedValue(new Error('timeout'));
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('Do not resend');
  expect(calls.some((call) => call.body?.status === 'acceptance_unknown')).toBe(true);
});
it('does not send a new request to a recipient with an unresolved attempt', async () => {
  const original = respond;
  respond = (call) => call.name === 'agent_email_attempts' && call.url.searchParams.has('to_email') ? Response.json([{ id: 'prior' }]) : original(call);
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('prior send');
  expect(gmailRequest).not.toHaveBeenCalled();
});
it('prevents content or sender changes from reusing an existing attempt ID', async () => {
  respond = () => Response.json({ id: options.attemptId, user_id: user, status: 'recorded', content_hash: 'different' });
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('different sender or content');
  expect(gmailRequest).not.toHaveBeenCalled();
});
it.each(['recorded', 'accepted_by_provider', 'acceptance_unknown'])('preserves pre-presentation-update retry safety for a %s attempt', async (status) => {
  const sender = { ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', signature: 'Taylor\nShield Assurance' };
  const content_hash = createHash('sha256').update(JSON.stringify({
    input: { ...input, body: `${input.body}\n\n-- \n${sender.signature}` }, options, connection: 'mailbox1', sender,
  })).digest('hex');
  const original = respond;
  respond = (call) => call.name === 'agent_email_attempts' && call.method === 'GET' && !call.url.searchParams.has('to_email')
    ? Response.json({ user_id: user, status, content_hash, communication_id: 'communication1' }) : original(call);
  if (status === 'acceptance_unknown') await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('Do not resend');
  else expect(await sendAgentEmail(db, user, input, options)).toMatchObject({ id: 'communication1' });
  expect(gmailRequest).not.toHaveBeenCalled();
});
it.each([false, true])('retains readable plain text, escaped HTML, website links and original attachment data (attachment=%s)', (attachment) => {
  const mime = agentMime({ ...input, body: 'Hello <script>\n\n-- \nTaylor\nhttps://www.shield-assurance.com',
    ...(attachment ? { attachments: [{ filename: 'quote.pdf', type: 'application/pdf', content: Buffer.from('original file').toString('base64') }] } : {}),
  }, 'taylor@example.invalid', 'Taylor', '<qa@example.invalid>');
  expect(mime).toContain('Content-Type: multipart/alternative;');
  expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
  expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
  const encoded = /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime)![1]!;
  const html = Buffer.from(encoded, 'base64').toString();
  expect(html).toContain('Hello &lt;script&gt;');
  expect(html).toContain('href="https://www.shield-assurance.com"');
  if (attachment) {
    expect(mime).toContain('Content-Type: multipart/mixed;');
    expect(mime).toContain('Content-Disposition: attachment; filename="quote.pdf"');
    expect(mime).toContain(Buffer.from('original file').toString('base64'));
  }
});
it('blocks concurrent duplicate claims without a second provider call', async () => {
  const original = respond;
  respond = (call) => call.name === 'agent_email_attempts' && call.method === 'POST'
    ? Response.json({ code: '23505', message: 'duplicate' }, { status: 409 }) : original(call);
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('Another request claimed');
  expect(gmailRequest).not.toHaveBeenCalled();
});
it('surfaces the shared mailbox limit without a Gmail request', async () => {
  const original = respond;
  respond = (call) => call.name === 'agent_email_attempts' && call.method === 'POST'
    ? Response.json({ code: 'PT429', message: 'mailbox limit' }, { status: 429 }) : original(call);
  await expect(sendAgentEmail(db, user, input, options)).rejects.toMatchObject({ status: 429 });
  expect(gmailRequest).not.toHaveBeenCalled();
});
it('retries bookkeeping for known acceptance without contacting Gmail', async () => {
  let stored: Record<string, unknown> | null = null;
  const original = respond;
  respond = (call) => {
    if (call.name === 'agent_email_attempts' && call.method === 'POST') stored = call.body;
    if (call.name === 'agent_email_attempts' && call.method === 'GET' && stored && !call.url.searchParams.has('to_email')) return Response.json({ ...stored, status: 'accepted_by_provider' });
    return original(call);
  };
  await sendAgentEmail(db, user, input, options);
  vi.mocked(gmailRequest).mockClear();
  expect(await sendAgentEmail(db, user, input, options)).toMatchObject({ id: 'communication1' });
  expect(gmailRequest).not.toHaveBeenCalled();
});
it('does not report success when accepted-message recording fails', async () => {
  const original = respond;
  respond = (call) => call.name === 'finalize_agent_email' ? Response.json({ code: 'XX000', message: 'database unavailable' }, { status: 500 }) : original(call);
  await expect(sendAgentEmail(db, user, input, options)).rejects.toThrow('recording is incomplete');
  expect(gmailRequest).toHaveBeenCalledTimes(1);
});
it.each([true, false])('uses only an own-mailbox thread mapping when replying (ownCopy=%s)', async (ownCopy) => {
  const original = respond;
  respond = (call) => call.name === 'communication_log' ? Response.json({ client_id: options.clientId, direction: 'inbound', subject: 'Review',
    metadata: { from: input.to, to: 'original-agent@example.invalid', rfc_message_id: '<prior@example.invalid>', references: '<original@example.invalid>' } })
    : call.name === 'gmail_message_links' ? Response.json(ownCopy ? { gmail_thread_id: 'own-thread' } : null) : original(call);
  await sendAgentEmail(db, user, { ...input, subject: 'Re: Review' }, { ...options, replyId: '10000000-0000-4000-8000-000000000004' });
  const providerInput: { raw: string; threadId?: string } = JSON.parse(String(vi.mocked(gmailRequest).mock.calls[0]?.[3]?.body));
  expect(providerInput.threadId).toBe(ownCopy ? 'own-thread' : undefined);
  expect(Buffer.from(providerInput.raw, 'base64url').toString().includes('In-Reply-To:')).toBe(ownCopy);
});
it('blocks a reply instead of silently sending to a changed primary email', async () => {
  const original = respond;
  respond = (call) => call.name === 'communication_log' ? Response.json({ client_id: options.clientId, direction: 'inbound', subject: 'Review', metadata: { from: 'different@example.invalid' } }) : original(call);
  await expect(sendAgentEmail(db, user, input, { ...options, replyId: '10000000-0000-4000-8000-000000000004' })).rejects.toThrow('different recipient');
  expect(gmailRequest).not.toHaveBeenCalled();
});
