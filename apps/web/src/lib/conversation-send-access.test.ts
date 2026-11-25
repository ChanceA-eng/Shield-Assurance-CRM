import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/communication-log/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { sendAgentEmail } from './agent-email';
import { sendOutboundEmail } from './email-adapter';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: () => 'Agent' }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./message-delivery', async (original) => ({
  ...await original<typeof import('./message-delivery')>(), resolveOutboundEmailRecipient: vi.fn(),
}));
vi.mock('./agent-email', () => ({ sendAgentEmail: vi.fn() }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));
vi.mock('./agency-membership', () => ({ agencyEnabled: () => false }));
vi.mock('./outreach-engine', () => ({ handleInboundReply: vi.fn() }));
vi.mock('./sales-templates', () => ({ templateSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./email-formatting', () => ({ messageDocument: () => undefined, signatureFormatting: vi.fn().mockResolvedValue({}) }));

const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const account = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const file = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
const user: User = { id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const requests: Array<{ path: string; body: unknown }> = [];
const urls: URL[] = [];
let allowed: boolean;
let checkFailed: boolean;
let fileVisible: boolean;
let documentChecks: boolean[];

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  urls.length = 0;
  allowed = true;
  checkFailed = false;
  fileVisible = true;
  documentChecks = [true, true];
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted', grants: {
    'messages.view': 'agency', 'messages.send': 'agency', 'leads.view': 'agency', 'accounts.view': 'agency',
  } } });
  vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({
    ok: true, recipient: { to: 'recipient@example.test', leadId: null, clientId: account },
  });
  vi.mocked(sendAgentEmail).mockResolvedValue({ id: account, provider: 'gmail', status: 'accepted_by_provider' });
  vi.mocked(sendOutboundEmail).mockResolvedValue('resend');
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      urls.push(url);
      const path = url.pathname;
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path.endsWith('/team_record_dispatch_allowed')) return checkFailed
        ? Response.json({ code: 'XX000', message: 'Authorization unavailable' }, { status: 500 })
        : Response.json(allowed);
      if (path.endsWith('/team_account_document_allowed')) return Response.json(documentChecks.shift() ?? true);
      if (path.endsWith('/client_files')) return Response.json(fileVisible
        ? [{ id: file, client_id: account, file_name: 'Quote', file_url: 'https://example.test/quote', metadata: {} }]
        : []);
      if (path.endsWith('/communication_log')) return Response.json({ id: account });
      return Response.json({ message: 'Unexpected request' }, { status: 500 });
    } },
  }));
});

describe('manual conversation send authorization', () => {
  it.each(['gmail', 'resend'] as const)('rechecks current record access before %s delivery', async (provider) => {
    const request = () => new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
        email_provider: provider, request_id: actor }),
    });
    allowed = false;
    expect((await POST(request())).status).toBe(403);
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(requests[0]).toEqual({ path: '/rest/v1/rpc/team_record_dispatch_allowed',
      body: { p_actor: actor, p_lead: null, p_client: account } });

    allowed = true;
    expect((await POST(request())).status).toBe(201);
    if (provider === 'gmail') expect(sendAgentEmail).toHaveBeenCalledOnce();
    else expect(sendOutboundEmail).toHaveBeenCalledOnce();
  });

  it('does not contact either provider if the authorization check fails', async () => {
    checkFailed = true;
    const response = await POST(new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account, email_provider: 'resend' }),
    }));
    expect(response.status).toBe(500);
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it('passes a fresh permission check to Gmail for its final handoff', async () => {
    vi.mocked(sendAgentEmail).mockImplementationOnce(async (_db, _actor, _input, _options, beforeDispatch) => {
      allowed = false;
      await beforeDispatch?.();
      return { id: account, provider: 'gmail', status: 'accepted_by_provider' };
    });
    const response = await POST(new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
        email_provider: 'gmail', request_id: actor }),
    }));
    expect(response.status).toBe(403);
    expect(requests.filter((item) => item.path.endsWith('/team_record_dispatch_allowed'))).toHaveLength(2);
  });

  it.each(['gmail', 'resend'] as const)('blocks %s delivery if contact restrictions change during preparation', async (provider) => {
    const recipient = { ok: true as const, recipient: { to: 'recipient@example.test', leadId: null, clientId: account } };
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValueOnce(recipient).mockResolvedValueOnce(recipient)
      .mockResolvedValueOnce({ ok: false, status: 403, code: 'opted_out', message: 'Recipient opted out.' });
    if (provider === 'gmail') {
      vi.mocked(sendAgentEmail).mockImplementationOnce(async (_db, _actor, _input, _options, beforeDispatch) => {
        await beforeDispatch?.();
        return { id: account, provider: 'gmail', status: 'accepted_by_provider' };
      });
    }
    const response = await POST(new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
        email_provider: provider, request_id: actor }),
    }));
    expect(response.status).toBe(403);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it('requires document permission and filters assigned document attachments by account assignment', async () => {
    const request = () => new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
        email_provider: 'resend', profile_file_ids: [file] }),
    });
    expect((await POST(request())).status).toBe(403);
    expect(urls.some((url) => url.pathname.endsWith('/client_files'))).toBe(false);

    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted', grants: {
      'messages.view': 'agency', 'messages.send': 'agency', 'leads.view': 'agency', 'accounts.view': 'agency',
      'documents.view': 'assigned',
    } } });
    fileVisible = false;
    expect((await POST(request())).status).toBe(400);
    const query = urls.find((url) => url.pathname.endsWith('/client_files'));
    expect(query?.searchParams.get('account.agent_user_id')).toBe(`eq.${actor}`);
    expect(sendOutboundEmail).not.toHaveBeenCalled();

    fileVisible = true;
    expect((await POST(request())).status).toBe(201);
    expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('https://example.test/quote') }));
  });

  it('does not send an attachment when document access is revoked after loading it', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted', grants: {
      'messages.view': 'agency', 'messages.send': 'agency', 'leads.view': 'agency', 'accounts.view': 'agency',
      'documents.view': 'agency',
    } } });
    documentChecks = [true, false];
    const response = await POST(new NextRequest('https://crm.example.test/api/communication-log', {
      method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
        email_provider: 'resend', profile_file_ids: [file] }),
    }));
    expect(response.status).toBe(403);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(requests.filter((item) => item.path.endsWith('/team_account_document_allowed'))).toHaveLength(2);
  });

  it('rejects invalid document selections instead of silently sending without them', async () => {
    for (const selection of [{ profile_file_ids: ['invalid'] }, { profile_files: [null] }]) {
      const response = await POST(new NextRequest('https://crm.example.test/api/communication-log', {
        method: 'POST', body: JSON.stringify({ channel: 'email', body: 'Hello', client_id: account,
          email_provider: 'resend', ...selection }),
      }));
      expect(response.status).toBe(400);
    }
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});
