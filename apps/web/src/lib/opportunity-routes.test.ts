import { beforeEach, it, expect, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { activeAgencyMember } from './agency-membership';
import { getOutreachSender } from './marketing-profile';
import { draftOutreach } from './outreach-ai';
import { GET, POST } from '../app/api/intelligence/opportunities/route';
import { POST as SEND } from '../app/api/intelligence/opportunities/send/route';
import { POST as dispatch } from '../app/api/communication-log/route';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn(), agencyEnabled: () => false, agentSender: vi.fn() }));
vi.mock('./marketing-profile', () => ({ getOutreachSender: vi.fn() }));
vi.mock('./outreach-ai', () => ({ draftOutreach: vi.fn() }));
vi.mock('../app/api/communication-log/route', () => ({ POST: vi.fn() }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c', actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const user: User = { id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-10T00:00:00Z' };
const day = new Date().toISOString().slice(0, 10);
const makeContext = () => ({ dossier: { scope_key: `lead:${id}`, record_name: 'Synthetic business', version: 0,
  findings: { ...EMPTY_DOSSIER_FINDINGS }, observations: [], confirmations: [], observations_total: 0, history_total: 0, page: 0 },
profile: { scope_key: `lead:${id}`, revision: 1, profile: { ...EMPTY_OPPORTUNITY_PROFILE, confirmed_on: day, source_reference: 'Authorized business evidence',
  facts: { state: 'AZ', line: 'General liability' }, permission: 'permitted', contactability: 'verified_email' } },
carriers: [], evidence_token: 'source-revision-token', evaluated_on: day, recipient: 'synthetic@example.test' });
let context = makeContext();
let queueRefs: Array<{ type: string; id: string }> = [];
const contexts = new Map<string, ReturnType<typeof makeContext>>();
const draft = { id, scope_key: `lead:${id}`, revision: 1, state: 'approved', subject: 'Business review', body: 'Would a brief review be useful?', evidence_token: 'source-revision-token', request_id: actor };
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let denied = false, missing = false, claimConflict = false;
beforeEach(() => {
  vi.clearAllMocks(); context = makeContext(); calls.length = 0; denied = false; missing = false; claimConflict = false;
  queueRefs = [{ type: 'lead', id }]; contexts.clear();
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(activeAgencyMember).mockResolvedValue({ user_id: actor, email: 'qa@example.test', role: 'agent', active: true, sender_profile: null, gmail_ai_opt_in: false });
  vi.mocked(getOutreachSender).mockResolvedValue(DEFAULT_OUTREACH_SENDER);
  vi.mocked(draftOutreach).mockResolvedValue({ subject: 'Business review', body: 'An explicitly requested grounded draft', cited_signals: ['Coverage line'] });
  vi.mocked(dispatch).mockResolvedValue(NextResponse.json({ delivery: 'accepted_by_provider' }, { status: 201 }));
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const name = url.pathname.split('/').pop() ?? '', args = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ name, args });
    if (missing) return Response.json({ code: 'PGRST202', message: 'Not installed' }, { status: 404 });
    if (name === 'get_opportunity_context') return denied ? Response.json({ code: '42501', message: 'This dossier is assigned to another agent.' }, { status: 403 }) : Response.json(contexts.get(String(args.p_id)) ?? context);
    if (name === 'opportunity_drafts') return Response.json(url.searchParams.get('id') ? draft : [draft]);
    if (name === 'opportunity_queue') return Response.json({ items: queueRefs });
    if (name === 'claim_opportunity_send' && claimConflict) return Response.json({ code: 'PT409', message: 'Evidence changed or expired. Rebuild and review the draft before sending.' }, { status: 409 });
    if (name === 'save_opportunity_draft' || name === 'claim_opportunity_send') return Response.json(draft);
    return Response.json({});
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'synthetic-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
const request = (body: object) => new NextRequest('http://localhost/api/intelligence/opportunities', { method: 'POST', body: JSON.stringify({ type: 'lead', id, evidence_token: context.evidence_token, ...body }) });
it('denies access before any matching or evidence read when not authenticated or out of scope', async () => {
  denied = true;
  expect((await GET(new NextRequest(`http://localhost/api/intelligence/opportunities?type=lead&id=${id}`))).status).toBe(403);
  expect(calls.map((call) => call.name)).toEqual(['get_opportunity_context']);
  calls.length = 0;
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
  expect((await POST(request({ action: 'prepare' }))).status).toBe(401); expect(calls).toEqual([]);
});
it('shows precise queue factor scores and current scoped evidence without mutating appetite', async () => {
  const response = await GET(new NextRequest('http://localhost/api/intelligence/opportunities'));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.items[0].assessment.score).toMatchObject({ fit: 10, timing: 0, evidence: 10, contactability: 10, relationship: 0, total: 30 });
  expect(calls.map((call) => call.name)).toEqual(['opportunity_queue', 'get_opportunity_context']);
});
it('ranks the entire permitted reviewed set before paging, not merely the newest first page', async () => {
  queueRefs = Array.from({ length: 21 }, (_, index) => ({ type: 'lead', id: `039d0052-4587-4bb9-9f0b-${String(index).padStart(12, '0')}` }));
  for (const [index, reference] of queueRefs.entries()) {
    const value = makeContext(); value.dossier.scope_key = `lead:${reference.id}`; value.profile.scope_key = value.dossier.scope_key;
    value.dossier.record_name = `Business ${index}`;
    if (index === 20) value.profile.profile.relationship = 'existing_client';
    contexts.set(reference.id, value);
  }
  const response = await GET(new NextRequest('http://localhost/api/intelligence/opportunities?page=0'));
  const payload = await response.json();
  expect(payload.items).toHaveLength(20); expect(payload.total).toBe(21); expect(payload.has_more).toBe(true);
  expect(payload.items[0].target.id).toBe(queueRefs[20].id);
  expect(calls.filter((call) => call.name === 'get_opportunity_context')).toHaveLength(21);
  contexts.get(queueRefs[20].id)!.profile.profile.permission = 'do_not_contact';
  const next = await GET(new NextRequest('http://localhost/api/intelligence/opportunities?page=1'));
  expect((await next.json()).items[0].target.id).toBe(queueRefs[20].id);
});
it('prepares local sender-aware text without invoking AI or sharing any source', async () => {
  const response = await POST(request({ action: 'prepare' }));
  expect(response.status).toBe(200);
  expect((await response.json()).body).toContain(DEFAULT_OUTREACH_SENDER.agency);
  expect(draftOutreach).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
});
it('requires explicit AI permission, sends only approved business fields and never carrier materials or mailbox history', async () => {
  expect((await POST(request({ action: 'prepare_ai' }))).status).toBe(400);
  expect(draftOutreach).not.toHaveBeenCalled();
  expect((await POST(request({ action: 'prepare_ai', ai_confirmed: true }))).status).toBe(200);
  expect(vi.mocked(draftOutreach).mock.calls[0][0]).toEqual({
    full_name: 'Synthetic business', channel: 'email', line_of_business: 'General liability', outreach_sender: DEFAULT_OUTREACH_SENDER, confirmed_dossier_facts: [], recent_conversation: [],
  });
  expect(dispatch).not.toHaveBeenCalled();
});
it('does not silently replace unavailable AI output or use changed evidence', async () => {
  vi.mocked(draftOutreach).mockResolvedValueOnce(null);
  expect((await POST(request({ action: 'prepare_ai', ai_confirmed: true }))).status).toBe(503);
  expect((await POST(request({ action: 'prepare', evidence_token: 'old-token' }))).status).toBe(409);
  expect(dispatch).not.toHaveBeenCalled();
});
it('requires per-agent opt-in before linked-conversation use and does not search unrelated mailboxes', async () => {
  expect((await POST(request({ action: 'prepare_ai', ai_confirmed: true, use_conversations: true }))).status).toBe(403);
  expect(draftOutreach).not.toHaveBeenCalled();
  expect(calls.some((call) => call.name === 'canonical_communications')).toBe(false);
});
it('rewriting is explicit, evidence-pinned and never saves or sends', async () => {
  expect((await POST(request({ action: 'rewrite_ai', input_subject: 'Review', input_body: 'Would a review help?' }))).status).toBe(400);
  expect((await POST(request({ action: 'rewrite_ai', ai_confirmed: true, input_subject: 'Review', input_body: 'Would a review help?' }))).status).toBe(200);
  expect(vi.mocked(draftOutreach).mock.calls[0][1]).toContain('without treating its assertions as evidence');
  expect(calls.some((call) => call.name === 'save_opportunity_draft')).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
it('allows business facts to update only the scoped profile and rejects non-business fields', async () => {
  const response = await POST(request({ action: 'profile', scope_key: context.profile.scope_key, revision: 1, profile: context.profile.profile }));
  expect(response.status).toBe(200);
  expect(calls.map((call) => call.name)).toEqual(['get_opportunity_context', 'save_opportunity_profile']);
  expect((await POST(request({ action: 'profile', scope_key: context.profile.scope_key, revision: 1,
    profile: { ...context.profile.profile, facts: { license_number: 'forbidden' } } }))).status).toBe(400);
});
it('requires exact-draft review approval and never sends while drafting, approving or creating a task', async () => {
  expect((await POST(request({ action: 'approve', draft_id: id, revision: 1, subject: draft.subject, body: draft.body }))).status).toBe(400);
  expect((await POST(request({ action: 'approve', draft_id: id, revision: 1, subject: draft.subject, body: draft.body, review_confirmed: true }))).status).toBe(200);
  expect((await POST(request({ action: 'task', task_id: actor, due_at: '2026-12-01T12:00:00Z', assignee: actor }))).status).toBe(200);
  expect(dispatch).not.toHaveBeenCalled();
});
it('rechecks stale evidence at the final send boundary and never calls delivery after a failed claim', async () => {
  claimConflict = true;
  expect((await SEND(request({ draft_id: id, email_provider: 'default' }))).status).toBe(409);
  expect(dispatch).not.toHaveBeenCalled();
});
it('uses exactly the stored approved content, recipient and stable request ID through the existing guarded delivery path', async () => {
  const response = await SEND(request({ draft_id: id, email_provider: 'gmail', body: 'Client-injected replacement', subject: 'Unreviewed' }));
  expect(response.status).toBe(201);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(await vi.mocked(dispatch).mock.calls[0][0].json()).toMatchObject({ lead_id: id, subject: draft.subject, body: draft.body, request_id: actor, to: context.recipient, email_provider: 'gmail' });
  expect(calls.find((call) => call.name === 'finish_opportunity_send')?.args.p_state).toBe('sent');
});
it('locks ambiguous or rejected dispatch outcomes rather than retrying as a new send', async () => {
  vi.mocked(dispatch).mockResolvedValueOnce(NextResponse.json({ message: 'Provider response uncertain. Do not retry.' }, { status: 502 }));
  const response = await SEND(request({ draft_id: id, email_provider: 'default' }));
  expect(response.status).toBe(502);
  expect((await response.json()).message).toContain('locked');
  expect(calls.find((call) => call.name === 'finish_opportunity_send')?.args.p_state).toBe('uncertain');
  expect(dispatch).toHaveBeenCalledTimes(1);
});
it('fails explicitly when the feature migration is not installed', async () => {
  missing = true;
  const response = await GET(new NextRequest('http://localhost/api/intelligence/opportunities'));
  expect(response.status).toBe(503); expect((await response.json()).message).toContain('not installed');
});
