import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { sendOutboundEmail } from './email-adapter';
import { draftSequenceStep } from './outreach-ai';
import { enrollLead, handleInboundReply, isOptedOut, processDueEnrollments, sendOutboxItem, sentTodayCount } from './outreach-engine';
import { inboundEventKey, twilioSignature } from './message-alerts';
import { POST as emailWebhook } from '../app/api/messages/webhook/route';
import { POST as smsWebhook } from '../app/api/messages/sms-webhook/route';
import { DEFAULT_EMAIL_DESIGN, DEFAULT_OUTREACH_SENDER, SALES_TEMPLATES } from '@crm/shared';
import { sendAgentEmail } from './agent-email';
import { getOwnGmailConnection } from './gmail-provider';
import { salesSequenceBlock } from './sales-sequences';
import { WorkspaceError } from './record-scope';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));
vi.mock('./outreach-ai', () => ({ draftSequenceStep: vi.fn() }));
vi.mock('./lead-outreach-context', () => ({ leadOutreachContext: vi.fn().mockResolvedValue({}) }));
vi.mock('./agent-email', () => ({ sendAgentEmail: vi.fn() }));
vi.mock('./gmail-provider', () => ({ getOwnGmailConnection: vi.fn() }));
vi.mock('./sales-sequences', async (original) => ({
  ...await original<typeof import('./sales-sequences')>(), salesSequenceBlock: vi.fn().mockResolvedValue(null),
}));

const leadId = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const outboxId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const logId = 'e7403980-5600-4320-ab0b-82b28536be42';
interface Call { url: URL; method: string; body: Record<string, unknown> | null }
let calls: Call[];
let db: SupabaseClient;
let respond: (call: Call) => Response;
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const failed = (message: string): Response => json({ message, code: 'XX000' }, 500);
const item = (status = 'pending_approval') => ({
  id: outboxId, lead_id: leadId, enrollment_id: leadId, step_number: 1, to_email: 'lead@example.invalid',
  subject: 'Coverage review', body: 'Real draft', status, cited_signals: [], created_at: new Date().toISOString(),
});
const defaultResponse = (call: Call): Response => {
  const name = call.url.pathname.split('/').pop();
  if (name === 'outreach_outbox') return json(call.method === 'PATCH' ? { id: outboxId } : item());
  if (name === 'outreach_settings') return json({ approval_mode: true, opt_out_footer: 'Reply unsubscribe to stop.' });
  if (name === 'outreach_opt_outs') return json([]);
  if (name === 'marketing_email_consents') return json({ email: 'lead@example.invalid' });
  if (name === 'leads') return json({ id: leadId, email: 'lead@example.invalid', account_id: null, form_payload: {} });
  if (name === 'claim_outreach_send' || name === 'finalize_outreach_send') return json(true);
  if (name === 'team_record_dispatch_allowed') return json(true);
  if (name === 'process_outreach_reply') return json({ sequenceLeadIds: [leadId] });
  return json([]);
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'test-unsubscribe-key-at-least-32-characters');
  vi.stubEnv('EMAIL_POSTAL_ADDRESS', '123 Test Street, Tucson, AZ 85701');
  vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid');
  vi.stubEnv('RESEND_REPLY_SYNC_READY', 'true');
  calls = [];
  respond = defaultResponse;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call);
    return respond(call);
  };
  db = createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(sendOutboundEmail).mockResolvedValue('resend');
});

describe('outreach send safety', () => {
  it('releases the outreach claim when access is revoked at the Gmail handoff', async () => {
    const actor = logId;
    let checks = 0;
    vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: outboxId, user_id: actor, email: 'agent@example.invalid', status: 'connected',
      sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: false, history_id: null });
    vi.mocked(sendAgentEmail).mockImplementationOnce(async (_db, _actor, _input, _options, beforeDispatch) => {
      await beforeDispatch?.();
      return { id: logId, provider: 'gmail', status: 'accepted_by_provider' };
    });
    respond = (call) => {
      const name = call.url.pathname.split('/').pop();
      if (name === 'team_record_dispatch_allowed') return json(++checks < 3);
      if (name === 'outreach_outbox' && call.method === 'GET') return json({ ...item(), agent_user_id: actor, gmail_connection_id: outboxId });
      if (name === 'agency_members') return json({ user_id: actor, role: 'owner', active: true });
      if (name === 'agent_email_attempts') return json(null);
      return defaultResponse(call);
    };
    await expect(sendOutboxItem(db, outboxId, undefined, actor)).rejects.toMatchObject({ status: 403 });
    expect(checks).toBe(3);
    expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH',
      body: expect.objectContaining({ status: 'pending_approval', sent_at: null }) }));
  });

  it.each(['gmail', 'shared'] as const)('rechecks staff access after claiming %s outreach and releases a denied claim', async (provider) => {
    const actor = logId;
    let checks = 0;
    vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: outboxId, user_id: actor, email: 'agent@example.invalid', status: 'connected',
      sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: false, history_id: null });
    respond = (call) => {
      const name = call.url.pathname.split('/').pop();
      if (name === 'team_record_dispatch_allowed') {
        expect(call.body).toEqual({ p_actor: actor, p_lead: leadId, p_client: null });
        return json(++checks === 1);
      }
      if (name === 'outreach_outbox' && call.method === 'GET') return json({ ...item(), agent_user_id: actor,
        gmail_connection_id: provider === 'gmail' ? outboxId : null });
      if (name === 'agency_members') return json({ user_id: actor, role: 'owner', active: true });
      if (name === 'agent_email_attempts') return json(null);
      return defaultResponse(call);
    };
    await expect(sendOutboxItem(db, outboxId, undefined, actor)).rejects.toMatchObject({ status: 403 });
    expect(checks).toBe(2);
    expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH',
      body: expect.objectContaining({ status: 'pending_approval', sent_at: null }) }));
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it.each(['gmail', 'shared'] as const)('preserves the approved branded design for %s and blocks changed or invalid snapshots', async (provider) => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    const actor = logId;
    const design = { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Agency', heading: 'Welcome' };
    const template = { ...SALES_TEMPLATES.find((value) => value.id === 'introduction')!, email_design: design };
    const plan = { actor, preset: 'initial_contact', stage: 'new', assigned_agent: actor, recipient: 'lead@example.invalid',
      sender: DEFAULT_OUTREACH_SENDER, facts: {}, auto_send: true, evidence: null,
      steps: [template, SALES_TEMPLATES.find((value) => value.id === 'close_loop')!].map((value) => ({
        template: value, subject: 'Reviewed subject', body: 'Reviewed body', requires_review: false,
      })) };
    let snapshot: unknown = Object.fromEntries(Object.entries(design).reverse());
    vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: outboxId, user_id: actor, email: 'agent@example.invalid', status: 'connected',
      sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: false, history_id: null });
    vi.mocked(sendAgentEmail).mockResolvedValue({ id: logId, provider: 'gmail', status: 'accepted_by_provider' });
    respond = (call) => {
      const name = call.url.pathname.split('/').pop();
      if (name === 'outreach_outbox' && call.method === 'GET') return json({ ...item(), agent_user_id: actor,
        gmail_connection_id: provider === 'gmail' ? outboxId : null,
        sales_template: { id: template.id, revision: template.revision, email_design: snapshot } });
      if (name === 'agency_members') return json({ user_id: actor, role: 'owner', active: true, email: 'agent@example.invalid' });
      if (name === 'sequence_enrollments') return json({ sales_plan: plan, enrolled_at: '2026-11-05T00:00:00Z' });
      if (name === 'agent_email_attempts') return json(call.url.searchParams.get('select')?.includes('status')
        ? null : { provider_message_id: 'gmail-message', provider_thread_id: 'gmail-thread' });
      return defaultResponse(call);
    };
    expect(await sendOutboxItem(db, outboxId, undefined, actor)).toMatchObject({ sent: true });
    if (provider === 'gmail') {
      expect(sendAgentEmail).toHaveBeenCalledWith(db, actor, expect.anything(),
        expect.objectContaining({ salesTemplate: expect.objectContaining({ email_design: design }) }), expect.any(Function));
    } else {
      expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({ emailDesign: design }));
    }
    vi.clearAllMocks();
    calls = [];
    snapshot = { ...design, heading: 'Changed' };
    await expect(sendOutboxItem(db, outboxId, undefined, actor)).rejects.toThrow('approved template design changed');
    snapshot = { ...design, button_url: 'javascript:alert(1)' };
    await expect(sendOutboxItem(db, outboxId, undefined, actor)).rejects.toThrow();
    expect(sendAgentEmail).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.pathname.endsWith('/claim_outreach_send'))).toBe(false);
  });
  it('restricts the personal Gmail timer to stored Gmail connections and explicitly auto-approved sales plans', async () => {
    respond = (call) => call.url.pathname.endsWith('/outreach_settings') ? defaultResponse(call) : json([]);
    expect(await processDueEnrollments(db, { limit: 1, after: leadId, gmailOnly: true })).toMatchObject({ next_cursor: null });
    const enrollments = calls.find((call) => call.url.pathname.endsWith('/sequence_enrollments'));
    expect(enrollments?.url.searchParams.get('gmail_connection_id')).toBe('not.is.null');
    expect(enrollments?.url.searchParams.get('sales_plan')).toBe('not.is.null');
    expect(enrollments?.url.searchParams.get('sales_plan->>auto_send')).toBe('eq.true');
    expect(enrollments?.url.searchParams.get('id')).toBe(`gt.${leadId}`);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it.each([false, true])('routes reviewed personal Gmail by its stored mailbox without Resend consent gates (rate limited=%s)', async (limited) => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.stubEnv('RESEND_REPLY_SYNC_READY', 'false');
    const actor = logId, mailbox = outboxId;
    vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: mailbox, user_id: actor, email: 'agent@example.invalid', status: 'connected',
      sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: false, history_id: null });
    const plan = { actor, preset: 'initial_contact', stage: 'new', assigned_agent: actor, recipient: 'lead@example.invalid',
      sender: DEFAULT_OUTREACH_SENDER, facts: {}, auto_send: true, evidence: null, steps: SALES_TEMPLATES.filter((template) => ['introduction', 'close_loop'].includes(template.id)).map((template) => ({
        template, subject: 'Reviewed subject', body: 'Reviewed body', requires_review: false,
      })) };
    respond = (call) => {
      const name = call.url.pathname.split('/').pop();
      if (name === 'outreach_outbox' && call.method === 'GET') return json({ ...item(), agent_user_id: actor,
        gmail_connection_id: mailbox, sales_template: { id: 'introduction', revision: 0 } });
      if (name === 'agency_members') return json({ user_id: actor, role: 'owner', active: true, email: 'agent@example.invalid' });
      if (name === 'sequence_enrollments') return json({ sales_plan: plan, enrolled_at: '2026-11-05T00:00:00Z' });
      if (name === 'marketing_email_consents') return json(null);
      if (name === 'agent_email_attempts') return json(call.url.searchParams.get('select')?.includes('status')
        ? null : { provider_message_id: 'gmail-message', provider_thread_id: 'gmail-thread' });
      return defaultResponse(call);
    };
    if (limited) {
      vi.mocked(sendAgentEmail).mockRejectedValueOnce(new WorkspaceError('Mailbox limit reached.', 429));
      await expect(sendOutboxItem(db, outboxId, undefined, actor)).rejects.toMatchObject({ status: 429 });
      expect(calls.filter((call) => call.method === 'PATCH' && call.url.pathname.endsWith('/outreach_outbox')))
        .toContainEqual(expect.objectContaining({ body: expect.objectContaining({ status: 'pending_approval', sent_at: null }) }));
    } else {
      vi.mocked(sendAgentEmail).mockResolvedValueOnce({ id: logId, provider: 'gmail', status: 'accepted_by_provider' });
      expect(await sendOutboxItem(db, outboxId, undefined, actor)).toMatchObject({ sent: true });
    }
    expect(salesSequenceBlock).toHaveBeenCalled();
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.pathname.endsWith('/marketing_email_consents'))).toBe(false);
  });
  it('recovers the missing draft for an existing active enrollment without inserting another enrollment or sending', async () => {
    vi.stubEnv('CRM_MULTI_AGENT_ENABLED', 'false');
    vi.mocked(draftSequenceStep).mockResolvedValue({ subject: 'Coverage review', body: 'Draft for review', cited_signals: ['Recorded fact'] });
    respond = (call) => {
      if (call.url.pathname.endsWith('/sequence_enrollments')) return json({ id: leadId, lead_id: leadId, status: 'active', current_step: 0, total_steps: 3 });
      if (call.url.pathname.endsWith('/outreach_outbox')) return json([], 200);
      if (call.url.pathname.endsWith('/create_outreach_draft')) return json(true);
      return defaultResponse(call);
    };
    expect(await enrollLead(db, leadId)).toMatchObject({ drafted: true, enrollment: { id: leadId } });
    expect(calls.some((call) => call.url.pathname.endsWith('/sequence_enrollments') && call.method === 'POST')).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('does not draft or restart a paused enrollment', async () => {
    respond = (call) => call.url.pathname.endsWith('/sequence_enrollments') ? json({ id: leadId, status: 'paused' }) : defaultResponse(call);
    expect(await enrollLead(db, leadId)).toMatchObject({ drafted: false, message: 'Already enrolled (paused).' });
    expect(draftSequenceStep).not.toHaveBeenCalled();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('requires affirmative marketing permission rather than the absence of an opt-out', async () => {
    respond = (call) => call.url.pathname.endsWith('/marketing_email_consents') ? json(null) : defaultResponse(call);
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('marketing permission');
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.pathname.endsWith('/claim_outreach_send'))).toBe(false);
  });
  it('blocks Resend sequences until reply synchronization is verified', async () => {
    vi.stubEnv('RESEND_REPLY_SYNC_READY', 'false');
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('reply syncing');
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.pathname.endsWith('/claim_outreach_send'))).toBe(false);
  });
  it('accepts a verified reply check without changing deployment flags', async () => {
    vi.stubEnv('RESEND_REPLY_SYNC_READY', 'false');
    respond = (call) => call.url.pathname.endsWith('/email_setup_checks')
      ? json({ verified_at: new Date().toISOString() }) : defaultResponse(call);
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(true);
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
  });
  it('honors provider suppressions before claiming or sending', async () => {
    respond = (call) => call.url.pathname.endsWith('/email_suppressions') ? json([{ email: 'lead@example.invalid' }]) : defaultResponse(call);
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('recovers a Resend webhook that recorded acceptance before the send response finished', async () => {
    let reads = 0;
    vi.mocked(sendOutboundEmail).mockResolvedValue('resend');
    respond = (call) => {
      if (call.url.pathname.endsWith('/outreach_outbox')) {
        if (call.method === 'PATCH') return json(null);
        reads += 1;
        if (reads > 1) return json({ status: 'accepted_by_provider', provider: 'resend' });
      }
      return defaultResponse(call);
    };
    expect(await sendOutboxItem(db, outboxId)).toMatchObject({ sent: true });
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)?.url.pathname).toBe('/rest/v1/rpc/finalize_outreach_send');
  });
  it('uses shared lead consent, never creates an account, and records acceptance rather than delivery', async () => {
    expect(await sendOutboxItem(db, outboxId)).toMatchObject({ sent: true, deliveryStatus: 'accepted_by_provider' });
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
    expect(sendOutboundEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lead@example.invalid', subject: 'Coverage review', body: expect.stringContaining('Real draft\n\n--\nReply unsubscribe to stop.'),
      purpose: 'marketing', requestId: `outreach:${outboxId}`, leadId,
      headers: expect.objectContaining({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
    }));
    expect(calls.some((call) => call.url.pathname.includes('link_lead_account') || call.url.pathname.endsWith('/clients'))).toBe(false);
    const accepted = calls.find((call) => call.method === 'PATCH');
    expect(accepted?.body).toMatchObject({ status: 'accepted_by_provider', provider: 'resend' });
    expect(calls.findIndex((call) => call.url.pathname.endsWith('/claim_outreach_send')))
      .toBeLessThan(calls.findIndex((call) => call.method === 'PATCH'));
    expect(calls.at(-1)?.url.pathname).toBe('/rest/v1/rpc/finalize_outreach_send');
  });

  it.each(['declined', 'opted_out', 'wrong_recipient'])('blocks %s before claiming or contacting the provider', async (reason) => {
    respond = (call) => {
      if (call.url.pathname.endsWith('/leads')) return json({
        id: leadId, email: reason === 'wrong_recipient' ? 'changed@example.invalid' : 'lead@example.invalid',
        account_id: null, form_payload: reason === 'declined' ? { metadata: { contactConsent: { accepted: false } } } : {},
      });
      if (reason === 'opted_out' && call.url.pathname.endsWith('/outreach_opt_outs')) return json([{ email: 'lead@example.invalid' }]);
      return defaultResponse(call);
    };
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.pathname.endsWith('/claim_outreach_send'))).toBe(false);
  });

  it('fails closed on consent persistence errors', async () => {
    respond = (call) => call.url.pathname.endsWith('/outreach_opt_outs') ? failed('opt-out store unavailable') : defaultResponse(call);
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('opt-out store unavailable');
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it('does not send if a parallel request won the claim', async () => {
    respond = (call) => call.url.pathname.endsWith('/claim_outreach_send') ? json(false) : defaultResponse(call);
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it.each(['sending', 'acceptance_unknown', 'failed', 'rejected', 'sent'])('never resends an item in %s', async (status) => {
    respond = (call) => call.url.pathname.endsWith('/outreach_outbox') ? json(item(status)) : defaultResponse(call);
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(false);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it('persists uncertain adapter results and refuses automatic retries', async () => {
    let status = 'pending_approval';
    respond = (call) => {
      if (call.url.pathname.endsWith('/outreach_outbox')) {
        if (call.method === 'PATCH') status = String(call.body?.status);
        return json(item(status));
      }
      return defaultResponse(call);
    };
    vi.mocked(sendOutboundEmail).mockRejectedValue(new Error('timeout after provider may have accepted'));
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('do not resend until reconciled');
    expect(status).toBe('acceptance_unknown');
    expect((await sendOutboxItem(db, outboxId)).sent).toBe(false);
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
  });

  it('surfaces failure to save provider acceptance instead of reporting success', async () => {
    respond = (call) => call.method === 'PATCH' ? failed('write unavailable') : defaultResponse(call);
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('accepted by provider, but acceptance could not be saved; do not resend');
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.url.pathname.endsWith('/finalize_outreach_send'))).toBe(false);
  });

  it('recovers accepted bookkeeping without contacting a provider again', async () => {
    respond = (call) => call.url.pathname.endsWith('/outreach_outbox') ? json(item('accepted_by_provider')) : defaultResponse(call);
    expect(await sendOutboxItem(db, outboxId)).toMatchObject({ sent: true, deliveryStatus: 'accepted_by_provider' });
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    respond = (call) => call.url.pathname.endsWith('/finalize_outreach_send') ? failed('task persistence unavailable') :
      call.url.pathname.endsWith('/outreach_outbox') ? json(item('accepted_by_provider')) : defaultResponse(call);
    await expect(sendOutboxItem(db, outboxId)).rejects.toThrow('bookkeeping failed');
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });

  it('surfaces reply, opt-out and processing lookup failures', async () => {
    respond = () => failed('database unavailable');
    await expect(handleInboundReply(db, { fromEmail: 'lead@example.invalid', body: 'unsubscribe' })).rejects.toThrow('database unavailable');
    await expect(isOptedOut(db, 'lead@example.invalid')).rejects.toThrow('database unavailable');
    await expect(sentTodayCount(db)).rejects.toThrow('database unavailable');
    await expect(processDueEnrollments(db)).rejects.toThrow('database unavailable');
  });

  it('recovers accepted bookkeeping during processing even with approval mode enabled', async () => {
    respond = (call) => {
      if (call.url.pathname.endsWith('/outreach_outbox')) return json([{ id: outboxId }]);
      if (call.url.pathname.endsWith('/sequence_enrollments')) return json([]);
      return defaultResponse(call);
    };
    expect(await processDueEnrollments(db)).toEqual({ drafted: 0, autoSent: 0, skipped: 0 });
    expect(calls.some((call) => call.url.pathname.endsWith('/finalize_outreach_send'))).toBe(true);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('limits background batches, advances past inspected records, and resets the cursor after the last page', async () => {
    respond = (call) => {
      if (call.url.pathname.endsWith('/outreach_outbox')) return json([]);
      if (call.url.pathname.endsWith('/sequence_enrollments')) return json([{ id: leadId, lead_id: leadId }]);
      if (call.url.pathname.endsWith('/leads')) return json(null);
      return defaultResponse(call);
    };
    expect(await processDueEnrollments(db, { limit: 1, after: outboxId })).toEqual({
      drafted: 0, autoSent: 0, skipped: 1, next_cursor: leadId,
    });
    const enrollments = calls.find((call) => call.url.pathname.endsWith('/sequence_enrollments'));
    expect(enrollments?.url.searchParams.get('limit')).toBe('1');
    expect(enrollments?.url.searchParams.get('id')).toBe(`gt.${outboxId}`);
    expect(enrollments?.url.searchParams.get('order')).toBe('id.asc');
    expect(calls.find((call) => call.url.pathname.endsWith('/outreach_outbox'))?.url.searchParams.get('limit')).toBe('10');
    respond = (call) => call.url.pathname.endsWith('/outreach_settings') ? defaultResponse(call) : json([]);
    expect(await processDueEnrollments(db, { limit: 1, after: leadId })).toMatchObject({ next_cursor: null });
    expect(sendOutboundEmail).not.toHaveBeenCalled();
    expect(draftSequenceStep).not.toHaveBeenCalled();
  });

  it.each(['due', 'existing_draft', 'prior_emails', 'draft_save', 'opt_out_write'])('surfaces %s processing errors', async (stage) => {
    vi.mocked(draftSequenceStep).mockResolvedValue({
      subject: 'Subject', body: 'Grounded draft', cited_signals: [],
    });
    respond = (call) => {
      const path = call.url.pathname;
      if (path.endsWith('/outreach_outbox')) {
        if (call.url.searchParams.get('status') === 'eq.accepted_by_provider') return json([]);
        if (call.method === 'HEAD') return stage === 'existing_draft' ? failed('draft lookup failed') :
          new Response(null, { headers: { 'Content-Range': '0-0/0' } });
        return stage === 'prior_emails' ? failed('prior email lookup failed') : json([]);
      }
      if (path.endsWith('/sequence_enrollments')) {
        if (stage === 'due') return failed('due lookup failed');
        if (call.method === 'PATCH') return failed('opt-out enrollment write failed');
        return json([{ id: leadId, lead_id: leadId, status: 'active', current_step: 0, total_steps: 3 }]);
      }
      if (stage === 'opt_out_write' && path.endsWith('/outreach_opt_outs')) return json({ email: 'lead@example.invalid' });
      if (path.endsWith('/create_outreach_draft')) return failed('draft insert failed');
      return defaultResponse(call);
    };
    await expect(processDueEnrollments(db)).rejects.toThrow();
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});

describe('inbound retry contracts', () => {
  function inboundResponses(call: Call): Response {
    if (call.url.pathname.endsWith('/leads')) return json([{ id: leadId, full_name: 'Lead', account_id: null, status: 'new' }]);
    if (call.url.pathname.endsWith('/clients')) return json([]);
    if (call.url.pathname.endsWith('/ingest_inbound_message')) return json({ id: logId, client_id: null, channel: 'email', direction: 'inbound' });
    if (call.url.pathname.endsWith('/alert_inbound_message')) return json({ taskCreated: true });
    return defaultResponse(call);
  }
  it('has stable provider identities and distinguishes fallback payloads', () => {
    expect(inboundEventKey('email', '<message>', { text: 'first' })).toBe(inboundEventKey('email', ' <message> ', { text: 'retry' }));
    expect(inboundEventKey('email', null, { text: 'first' })).toBe(inboundEventKey('email', '', { text: 'first' }));
    expect(inboundEventKey('email', null, { text: 'first' })).not.toBe(inboundEventKey('email', null, { text: 'second' }));
    expect(inboundEventKey('sms', 'same', null)).not.toBe(inboundEventKey('email', 'same', null));
  });

  it('retires the unsigned legacy email receiver without changing any record', async () => {
    expect((await emailWebhook()).status).toBe(410);
    expect(calls).toHaveLength(0);
  });

  it('requires Twilio identity and returns retryable failure for saved texts with failed alerts', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token');
    respond = (call) => call.url.pathname.endsWith('/alert_inbound_message') ? failed('alerts unavailable') : inboundResponses(call);
    const smsRequest = (params: Record<string, string>) => {
      const url = 'http://localhost/api/messages/sms-webhook';
      return new NextRequest(url, { method: 'POST', body: new URLSearchParams(params), headers: {
        'x-twilio-signature': twilioSignature('test-token', url, params),
      } });
    };
    expect((await smsWebhook(smsRequest({ From: '+15555550123', Body: 'STOP' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await smsWebhook(smsRequest({ From: '+15555550123', Body: 'STOP', MessageSid: 'SM-test' }))).status).toBe(500);
    const reply = calls.find((call) => call.url.pathname.endsWith('/process_outreach_reply'));
    expect(reply?.body).toMatchObject({ p_phone: '+15555550123', p_body: 'STOP', p_log_id: logId });
  });
});
