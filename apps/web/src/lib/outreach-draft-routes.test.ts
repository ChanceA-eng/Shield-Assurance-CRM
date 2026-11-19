import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { DEFAULT_OUTREACH_SENDER, EMPTY_DOSSIER_FINDINGS, EMPTY_MARKETING_PROFILE } from '@crm/shared';
import { POST as leadDraft } from '../app/api/leads/[id]/draft-outreach/route';
import { POST as accountDraft } from '../app/api/ai/draft-message/route';
import { draftOutreach, generateTalkingPoints } from './outreach-ai';
import { getSupabaseServerClient } from './supabase-server';
import { WorkspaceError } from './record-scope';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({
  requireApiSession: vi.fn().mockResolvedValue(null),
  getApiSession: vi.fn().mockResolvedValue({ user: { id: 'qa' }, error: null }),
  apiActorName: vi.fn().mockReturnValue('Verification producer'),
}));
vi.mock('./outreach-ai', () => ({ draftOutreach: vi.fn(), generateTalkingPoints: vi.fn() }));
vi.mock('./lead-outreach-context', () => {
  const context = {
    workspace_assets: [], workspace_notes: [],
    marketing_profile: { ...EMPTY_MARKETING_PROFILE, interests: 'Commercial auto' },
    outreach_sender: DEFAULT_OUTREACH_SENDER,
    recent_conversation: [{ direction: 'inbound', subject: 'VIN', body: 'VIN was already supplied.', sent_at: '2026-10-31T12:00:00Z' }],
  };
  return {
    leadOutreachContext: vi.fn().mockResolvedValue(context),
    recordOutreachContext: vi.fn().mockResolvedValue(context),
  };
});

const id = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const draft = { subject: 'Your request', body: 'A generated message', cited_signals: ['Commercial auto'] };
const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let dossierCalls: unknown[];
let dossierPayload: (scopeKey: string) => unknown;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(draftOutreach).mockResolvedValue(draft);
  vi.mocked(generateTalkingPoints).mockResolvedValue({
    points: ['Ask about the confirmed priority.'],
    cited_signals: ['Agent-confirmed dossier finding'],
  });
  dossierCalls = [];
  const findings = { ...EMPTY_DOSSIER_FINDINGS, stated_priorities: 'Reliable certificate turnaround' };
  dossierPayload = (scopeKey) => ({
    scope_key: scopeKey,
    version: 1,
    findings,
    current_confirmation: {
      scope_key: scopeKey, version: 1, source_as_of: '2026-11-02',
      reference: 'Private CRM call note', findings,
    },
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith('/rpc/get_intelligence_dossier')) {
      const args = JSON.parse(String(init?.body)) as { p_type: string; p_id: string };
      dossierCalls.push(args);
      return json(dossierPayload(`${args.p_type}:${args.p_id}`));
    }
    if (url.pathname.endsWith('/leads')) return json({ id, full_name: 'Leo', line_of_business: 'Commercial auto' });
    if (url.pathname.endsWith('/clients')) return json({ full_name: 'Leo', preferred_channel: 'email' });
    if (url.pathname.endsWith('/policies')) return json([{ carrier: 'Recorded carrier', line_of_business: 'Auto', status: 'active' }]);
    return json([]);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});

const request = (account: boolean, value: unknown): NextRequest => new NextRequest(
  account ? `http://localhost/api/ai/draft-message?clientId=${id}` : `http://localhost/api/leads/${id}/draft-outreach`,
  { method: 'POST', body: JSON.stringify(value) },
);
const post = (account: boolean, value: unknown): Promise<Response> => account
  ? accountDraft(request(true, value))
  : leadDraft(request(false, value), { params: Promise.resolve({ id }) });

describe('personalized lead and account drafting routes', () => {
  it.each([false, true])('passes sender, contact priorities, canonical history and purpose (account=%s)', async (account) => {
    const response = await post(account, { mode: 'draft', instruction: 'Keep it specific', prompt: 'Keep it specific', template: 'renewal_review' });
    expect(response.status).toBe(200);
    expect(draftOutreach).toHaveBeenCalledWith(expect.objectContaining({
      marketing_profile: expect.objectContaining({ interests: 'Commercial auto' }),
      outreach_sender: DEFAULT_OUTREACH_SENDER,
      recent_conversation: expect.arrayContaining([expect.objectContaining({ body: 'VIN was already supplied.' })]),
    }), 'Keep it specific', 'renewal_review');
    expect(await response.json()).toMatchObject({ cited_signals: ['Commercial auto'] });
  });
  it.each([false, true])('returns quality failures explicitly without a substitute (account=%s)', async (account) => {
    vi.mocked(draftOutreach).mockRejectedValue(new WorkspaceError('Quality checks did not pass.', 422));
    const response = await post(account, { prompt: 'Follow up', instruction: 'Follow up' });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: 'Quality checks did not pass.' });
  });
  it.each([false, true])('preserves a provider timeout instead of blaming missing configuration (account=%s)', async (account) => {
    vi.mocked(draftOutreach).mockRejectedValue(new WorkspaceError('AI drafting timed out. Try again with a shorter instruction. No message was sent.', 504));
    const response = await post(account, { prompt: 'Follow up', instruction: 'Follow up' });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ message: 'AI drafting timed out. Try again with a shorter instruction. No message was sent.' });
  });
  it('does not describe unusable talking points as a missing API key', async () => {
    vi.mocked(generateTalkingPoints).mockResolvedValue(null);
    const response = await post(false, { mode: 'talking_points' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'AI returned no usable talking points. Try again or review the lead details. No message was sent.' });
  });
  it.each([false, true])('rejects unknown purpose before calling AI (account=%s)', async (account) => {
    expect((await post(account, { prompt: 'Follow up', template: 'unknown' })).status).toBe(400);
    expect(draftOutreach).not.toHaveBeenCalled();
  });
  it('passes the SMS channel through to output validation', async () => {
    expect((await post(true, { prompt: 'Ask for the VIN', channel: 'sms' })).status).toBe(200);
    expect(draftOutreach).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms' }), 'Ask for the VIN', undefined);
  });
  it.each([false, true])('uses only current agent-confirmed dossier facts after explicit opt-in (account=%s)', async (account) => {
    const response = await post(account, { prompt: 'Personalize this', instruction: 'Personalize this', include_dossier: true });
    expect(response.status).toBe(200);
    expect(dossierCalls).toHaveLength(1);
    expect(draftOutreach).toHaveBeenCalledWith(expect.objectContaining({
      confirmed_dossier_facts: [{
        field: 'stated_priorities',
        label: 'Prospect-stated priorities',
        value: 'Reliable certificate turnaround',
        source_as_of: '2026-11-02',
      }],
    }), 'Personalize this', undefined);
    const result = await response.json();
    expect(result.dossier_facts_included).toEqual(['Prospect-stated priorities']);
    expect(JSON.stringify(vi.mocked(draftOutreach).mock.calls[0][0])).not.toContain('Private CRM call note');
  });
  it.each([false, true])('does not read dossier findings without explicit opt-in (account=%s)', async (account) => {
    const response = await post(account, { prompt: 'Follow up', instruction: 'Follow up' });
    expect(response.status).toBe(200);
    expect(dossierCalls).toEqual([]);
    expect(draftOutreach).toHaveBeenCalledTimes(1);
    expect(vi.mocked(draftOutreach).mock.calls[0][0]).toMatchObject({ confirmed_dossier_facts: [] });
  });
  it.each([false, true])('rejects malformed dossier opt-in before calling AI (account=%s)', async (account) => {
    const response = await post(account, { prompt: 'Follow up', include_dossier: 'yes' });
    expect(response.status).toBe(400);
    expect(dossierCalls).toEqual([]);
    expect(draftOutreach).not.toHaveBeenCalled();
  });
  it('uses only current confirmed dossier facts for an explicitly opted-in call prep request', async () => {
    const response = await post(false, { mode: 'talking_points', include_dossier: true });
    expect(response.status).toBe(200);
    expect(dossierCalls).toHaveLength(1);
    expect(generateTalkingPoints).toHaveBeenCalledWith(expect.objectContaining({
      confirmed_dossier_facts: [{
        field: 'stated_priorities',
        label: 'Prospect-stated priorities',
        value: 'Reliable certificate turnaround',
        source_as_of: '2026-11-02',
      }],
    }));
    expect(await response.json()).toMatchObject({
      dossier_requested: true,
      dossier_facts_included: ['Prospect-stated priorities'],
      cited_signals: ['Agent-confirmed dossier finding'],
    });
  });
  it('does not load dossier facts for call prep without opt-in', async () => {
    const response = await post(false, { mode: 'talking_points' });
    expect(response.status).toBe(200);
    expect(dossierCalls).toEqual([]);
    expect(generateTalkingPoints).toHaveBeenCalledWith(expect.objectContaining({ confirmed_dossier_facts: [] }));
  });
  it('refuses call prep when requested dossier facts do not match the current confirmation', async () => {
    const confirmedPayload = dossierPayload;
    dossierPayload = (scopeKey) => {
      const current = confirmedPayload(scopeKey) as Record<string, unknown>;
      return { ...current, version: 2 };
    };
    const response = await post(false, { mode: 'talking_points', include_dossier: true });
    expect(response.status).toBe(503);
    expect(generateTalkingPoints).not.toHaveBeenCalled();
  });
});
