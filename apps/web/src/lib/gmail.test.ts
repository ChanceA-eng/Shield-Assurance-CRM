import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { gmailAddresses, gmailContent, gmailMessages, matchGmailThread, type GmailMessage } from './gmail-sync';
import { openGmailSecret, sealGmailSecret, assertGmailEnabled } from './gmail-provider';
import { agentMime } from './agent-email';
import { eligibleAiMessages } from './lead-outreach-context';

const user = '10000000-0000-4000-8000-000000000001';
const message = (from: string, to: string, extra?: string): GmailMessage => ({
  id: 'm1', threadId: 't1', internalDate: '1780000000000',
  payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: to }, ...(extra ? [{ name: 'Cc', value: extra }] : [])] },
});
const contact = { email: 'client@example.invalid', clientId: 'c1', leadId: null };
beforeEach(() => {
  vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v1');
  vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
});
afterEach(() => vi.unstubAllEnvs());

describe('private Gmail authorization', () => {
  it('encrypts using randomized authenticated ciphertext and binds it to the agent', () => {
    const first = sealGmailSecret('test-refresh-value', user);
    expect(first).not.toContain('test-refresh-value');
    expect(first).not.toBe(sealGmailSecret('test-refresh-value', user));
    expect(openGmailSecret(first, user)).toBe('test-refresh-value');
    expect(() => openGmailSecret(first, 'other-agent')).toThrow('cannot be decrypted');
    const pieces = first.split('.'); pieces[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openGmailSecret(pieces.join('.'), user)).toThrow('cannot be decrypted');
  });
  it('can read old key versions during rotation without using them for new writes', () => {
    const old = sealGmailSecret('old-grant', user);
    vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64'), v2: Buffer.alloc(32, 9).toString('base64') }));
    vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v2');
    expect(openGmailSecret(old, user)).toBe('old-grant');
    expect(sealGmailSecret('new-grant', user)).toMatch(/^v2\./);
  });
  it('rejects invalid key setup without exposing its contents', () => {
    vi.stubEnv('GMAIL_TOKEN_KEYS', 'not-valid-sensitive-json');
    expect(() => sealGmailSecret('grant', user)).toThrow('keyring JSON is invalid');
    vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: 'too-short' }));
    expect(() => sealGmailSecret('grant', user)).toThrow('32 bytes');
  });
  it('requires both feature gates', () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'true'); vi.stubEnv('CRM_GMAIL_ENABLED', 'false');
    expect(assertGmailEnabled).toThrow('not enabled');
    vi.stubEnv('CRM_GMAIL_ENABLED', 'true');
    expect(assertGmailEnabled).not.toThrow();
  });
});
describe('exact contact matching and safe MIME import', () => {
  const known = new Map([[contact.email, [contact]]]);
  it('matches exact normalized addresses and explicitly linked lead identities', () => {
    const linked = { ...contact, leadId: 'l1' };
    const contacts = new Map([[contact.email, [contact, linked]]]);
    expect(matchGmailThread([message('Agent <agent@example.invalid>', 'Client <CLIENT@example.invalid>')], 'agent@example.invalid', contacts)).toEqual(linked);
    expect(gmailAddresses('Client <CLIENT@example.invalid>, Other <other@example.invalid>')).toEqual(['client@example.invalid', 'other@example.invalid']);
  });
  it.each([
    ['client+other@example.invalid', undefined],
    ['client@example.invalid', 'unknown@example.invalid'],
    ['nobody@example.invalid', undefined],
  ])('does not infer or import an unrelated/mixed thread (%s)', (to, cc) => {
    expect(matchGmailThread([message('agent@example.invalid', to, cc)], 'agent@example.invalid', known)).toBeNull();
  });
  it('holds duplicates across unrelated accounts and never equates dotted/plus addresses', () => {
    const duplicate = new Map([[contact.email, [contact, { ...contact, clientId: 'c2' }]]]);
    expect(matchGmailThread([message('agent@example.invalid', contact.email)], 'agent@example.invalid', duplicate)).toBeNull();
    expect(matchGmailThread([message('agent@example.invalid', 'cl.ient@example.invalid')], 'agent@example.invalid', known)).toBeNull();
  });
  it('prefers plain text, stores attachment metadata only, and rejects oversized text', () => {
    const encoded = (text: string): string => Buffer.from(text).toString('base64url');
    expect(gmailContent({ parts: [
      { mimeType: 'text/html', body: { data: encoded('<b>Different html</b>') } },
      { mimeType: 'text/plain', body: { data: encoded('Actual plain message') } },
      { filename: 'policy.pdf', body: { data: encoded('do-not-import-bytes'), size: 19 } },
    ] })).toEqual({ text: 'Actual plain message', attachments: [{ name: 'policy.pdf', size: 19, imported: false }] });
    expect(gmailContent({ mimeType: 'text/html', body: { data: encoded('<script>tracking()</script><p>Hello &amp; welcome</p>') } }).text).toBe('Hello & welcome\n\n');
    expect(() => gmailContent({ mimeType: 'text/plain', body: { data: Buffer.alloc(2000001).toString('base64url') } })).toThrow('2 MB');
  });
  it('validates provider message shapes before reading headers and bodies', () => {
    expect(() => gmailMessages({ messages: [{ id: 'm', threadId: 't', internalDate: 'invalid', payload: {} }] })).toThrow('invalid message');
    expect(() => gmailMessages({ messages: [{ ...message('a@example.invalid', contact.email), payload: { headers: [null] } }] })).toThrow('Invalid Gmail headers');
    expect(gmailMessages({ messages: [message('a@example.invalid', contact.email)] })[0]?.id).toBe('m1');
  });
  it('builds explicit-agent UTF-8 MIME, reply references and existing outgoing attachments', () => {
    const raw = agentMime({ to: contact.email, subject: 'Policy résumé', body: 'Hello', attachments: [{ filename: 'policy.pdf', content: 'cGRm', type: 'application/pdf' }] },
      'agent@example.invalid', 'Taylor', '<crm-test@example.invalid>', { messageId: '<prior@example.invalid>', references: '<original@example.invalid>' });
    expect(raw).toContain('<agent@example.invalid>');
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Policy résumé').toString('base64')}?=`);
    expect(raw).toContain('In-Reply-To: <prior@example.invalid>');
    expect(raw).toContain('References: <original@example.invalid> <prior@example.invalid>');
    expect(raw).toContain('filename="policy.pdf"');
    expect(raw).toContain('cGRm');
    expect(() => agentMime({ to: contact.email, subject: 'x\r\nBcc: other@example.invalid', body: 'test' }, 'agent@example.invalid', 'Taylor', '<id>')).toThrow('line breaks');
  });
});
describe('Gmail content AI permissions', () => {
  const gmail = { id: 'log1', direction: 'inbound', subject: 'Question', body: 'Private Gmail content', sent_at: '', metadata: { gmail_origin: true, agent_user_id: user } };
  const native = { direction: 'inbound', subject: 'CRM', body: 'Native message', sent_at: '' };
  const db = (members: Array<{ user_id: string; active: boolean; gmail_ai_opt_in: boolean }>) => createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input) => {
      const path = String(input);
      return Response.json(path.includes('gmail_message_links') ? [{ connection_id: 'mailbox2' }] : path.includes('gmail_connections') ? [{ user_id: 'other' }] : members);
    } },
  });
  it('excludes Gmail entirely when the global provider/privacy gate is off', async () => {
    vi.stubEnv('CRM_GMAIL_AI_ENABLED', 'false');
    expect(await eligibleAiMessages(db([]), [gmail, native])).toEqual([native]);
  });
  it.each([false, true])('requires every cross-mailbox source to be active and opted in (active=%s)', async (active) => {
    vi.stubEnv('CRM_GMAIL_AI_ENABLED', 'true');
    expect(await eligibleAiMessages(db([{ user_id: user, active: true, gmail_ai_opt_in: true }, { user_id: 'other', active, gmail_ai_opt_in: false }]), [gmail, native])).toEqual([native]);
  });
  it('includes Gmail only when all known source agents authorize it', async () => {
    vi.stubEnv('CRM_GMAIL_AI_ENABLED', 'true');
    expect(await eligibleAiMessages(db([{ user_id: user, active: true, gmail_ai_opt_in: true }, { user_id: 'other', active: true, gmail_ai_opt_in: true }]), [gmail])).toEqual([gmail]);
  });
});
