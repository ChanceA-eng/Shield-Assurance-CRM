import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { sendOutboundEmail } from './email-adapter';
import { draftSequenceStep } from './outreach-ai';
import { handleInboundReply, isOptedOut, processDueEnrollments, sendOutboxItem, sentTodayCount } from './outreach-engine';
import { inboundEventKey, twilioSignature } from './message-alerts';
import { POST as emailWebhook } from '../app/api/messages/webhook/route';
import { POST as smsWebhook } from '../app/api/messages/sms-webhook/route';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));
vi.mock('./outreach-ai', () => ({ draftSequenceStep: vi.fn() }));
vi.mock('./lead-outreach-context', () => ({ leadOutreachContext: vi.fn().mockResolvedValue({}) }));

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
  if (name === 'leads') return json({ id: leadId, email: 'lead@example.invalid', account_id: null, form_payload: {} });
  if (name === 'claim_outreach_send' || name === 'finalize_outreach_send') return json(true);
  if (name === 'process_outreach_reply') return json({ sequenceLeadIds: [leadId] });
  return json([]);
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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
  vi.mocked(sendOutboundEmail).mockResolvedValue('sendgrid');
});

describe('outreach send safety', () => {
  it('uses shared lead consent, never creates an account, and records acceptance rather than delivery', async () => {
    expect(await sendOutboxItem(db, outboxId)).toMatchObject({ sent: true, deliveryStatus: 'accepted_by_provider' });
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1);
    expect(sendOutboundEmail).toHaveBeenCalledWith({
      to: 'lead@example.invalid', subject: 'Coverage review', body: 'Real draft\n\n--\nReply unsubscribe to stop.',
    });
    expect(calls.some((call) => call.url.pathname.includes('link_lead_account') || call.url.pathname.endsWith('/clients'))).toBe(false);
    const accepted = calls.find((call) => call.method === 'PATCH');
    expect(accepted?.body).toMatchObject({ status: 'accepted_by_provider', provider: 'sendgrid' });
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
  const requestEmail = (body: Record<string, string>) => new NextRequest('http://localhost/api/messages/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
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

  it('reuses SendGrid header message identity and recovers after alert persistence failure', async () => {
    vi.stubEnv('INBOUND_WEBHOOK_SECRET', '');
    let failedOnce = false;
    respond = (call) => {
      if (call.url.pathname.endsWith('/alert_inbound_message') && !failedOnce) {
        failedOnce = true;
        return failed('alerts unavailable');
      }
      return inboundResponses(call);
    };
    const payload = { from: 'Lead <lead@example.invalid>', to: 'reply@example.invalid', text: 'Question', headers: 'From: Lead\r\nMessage-ID: <provider-message>\r\n' };
    expect((await emailWebhook(requestEmail(payload))).status).toBe(500);
    expect((await emailWebhook(requestEmail(payload))).status).toBe(200);
    const receipts = calls.filter((call) => call.url.pathname.endsWith('/ingest_inbound_message'));
    expect(receipts).toHaveLength(2);
    expect(receipts[0].body?.p_event_key).toBe(receipts[1].body?.p_event_key);
    expect(receipts[0].body?.p_provider_id).toBe('<provider-message>');
    expect(calls.filter((call) => call.url.pathname.endsWith('/process_outreach_reply')).every((call) => call.body?.p_log_id === logId)).toBe(true);
    expect(calls.some((call) => call.method === 'POST' && call.url.pathname.endsWith('/communication_log'))).toBe(false);
  });

  it('keeps identity-less email fingerprints stable when receipt times differ', async () => {
    vi.stubEnv('INBOUND_WEBHOOK_SECRET', '');
    respond = inboundResponses;
    const payload = { from: 'lead@example.invalid', text: 'Same reply' };
    expect((await emailWebhook(requestEmail(payload))).status).toBe(200);
    expect((await emailWebhook(requestEmail(payload))).status).toBe(200);
    const receipts = calls.filter((call) => call.url.pathname.endsWith('/ingest_inbound_message'));
    expect(receipts[0].body?.p_event_key).toBe(receipts[1].body?.p_event_key);
  });

  it('does not acknowledge successful email processing if the reply transaction failed', async () => {
    vi.stubEnv('INBOUND_WEBHOOK_SECRET', '');
    respond = (call) => call.url.pathname.endsWith('/process_outreach_reply') ? failed('reply unavailable') : inboundResponses(call);
    expect((await emailWebhook(requestEmail({ from: 'lead@example.invalid', text: 'unsubscribe', 'message-id': 'one' }))).status).toBe(500);
    expect(calls.some((call) => call.url.pathname.endsWith('/alert_inbound_message'))).toBe(false);
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
