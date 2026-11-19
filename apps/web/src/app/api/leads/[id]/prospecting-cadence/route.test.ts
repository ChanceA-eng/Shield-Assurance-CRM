import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from './route';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../../lib/agency-membership';
import { resolveOutboundEmailRecipient } from '../../../../../lib/message-delivery';

vi.mock('../../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../../lib/supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('../../../../../lib/agency-membership', () => ({ activeAgencyMember: vi.fn(), agencyEnabled: () => false, agentSender: vi.fn() }));
vi.mock('../../../../../lib/message-delivery', () => ({ resolveOutboundEmailRecipient: vi.fn() }));
vi.mock('../../../../../lib/outreach-engine', () => ({ getOutreachSettings: async () => ({ timezone: 'America/Phoenix' }) }));

const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const lead = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const cadence = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
const touch = '168413e9-a6a4-4dff-a8bf-8f8df83dace9';
const otherTouch = '168413e9-a6a4-4dff-a8bf-8f8df83dace0';
const context = { params: Promise.resolve({ id: lead }) };
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (method: string, body?: unknown) => new NextRequest(`http://localhost/api/leads/${lead}/prospecting-cadence`, {
  method, ...(body ? { body: JSON.stringify(body) } : {}),
});

function database() {
  const mutations: Array<{ name: string; body: Record<string, unknown> }> = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const name = url.pathname.split('/').pop() ?? '';
      if (name === 'get_record_business_research') return json({ business: null, linked_record: { type: 'lead', id: lead }, job: null });
      if (init?.method === 'POST') {
        mutations.push({ name, body: JSON.parse(String(init.body)) });
        return json(name === 'create_prospecting_cadence' ? cadence : null);
      }
      if (name === 'leads') return json({ id: lead, agent_user_id: actor, source: 'prospect_import', form_payload: {} });
      if (name === 'prospecting_cadences') return json({
        id: cadence, lead_id: lead, agent_user_id: actor, status: 'active', voicemail_count: 0, ended_reason: null, context: {},
      });
      if (name === 'prospecting_cadence_touches') return json([{
        id: touch, touch_number: 1, channel: 'call', due_at: '2026-11-01T16:00:00Z', status: 'planned',
        outcome: null, voicemail: false, task_id: null, outbox_id: null,
      }]);
      return json({ message: `Unexpected table ${name}` }, 500);
    } },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(client);
  return mutations;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({
    user: { id: actor, aud: 'authenticated', created_at: '', app_metadata: {}, user_metadata: {} }, error: null,
  });
  vi.mocked(activeAgencyMember).mockResolvedValue({
    user_id: actor, email: 'synthetic@example.invalid', role: 'agent', active: true, sender_profile: null, gmail_ai_opt_in: false,
  });
  vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({
    ok: true, recipient: { to: 'synthetic@example.invalid', leadId: lead, clientId: null },
  });
});

describe('lead prospecting plan API', () => {
  it('returns a lead-scoped plan and transparent contact-only readiness', async () => {
    database();
    const response = await GET(request('GET'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cadence: { id: cadence, touches: [{ id: touch }] }, can_manage: true, can_cancel: true,
      readiness: { data_level: 'contact-only', suggested_priority: 'C' },
    });
  });
  it('requires explicit opt-in and accepts a producer-selected priority with a source snapshot', async () => {
    const mutations = database();
    expect((await POST(request('POST', { priority: 'A' }), context)).status).toBe(400);
    const response = await POST(request('POST', { confirm: true, priority: 'B' }), context);
    expect(response.status).toBe(201);
    expect(mutations).toEqual([{
      name: 'create_prospecting_cadence',
      body: expect.objectContaining({
        p_actor: actor, p_lead: lead, p_mailbox: null,
        p_touches: expect.arrayContaining([expect.objectContaining({ touch_number: 1, channel: 'call' }), expect.objectContaining({ touch_number: 8, channel: 'call' })]),
        p_context: expect.objectContaining({ priority: 'B', data_level: 'contact-only', acquisition_source: 'prospect_import' }),
      }),
    }]);
  });
  it('rejects a touch from another plan before calling the outcome RPC', async () => {
    const mutations = database();
    const response = await PATCH(request('PATCH', { action: 'log_call', touch_id: otherTouch, outcome: 'connected' }), context);
    expect(response.status).toBe(400);
    expect(mutations).toEqual([]);
  });
  it('requires confirmed renewal timing before saving a nurture reminder', async () => {
    const mutations = database();
    const response = await PATCH(request('PATCH', { action: 'nurture_reminder' }), context);
    expect(response.status).toBe(409);
    expect(mutations).toEqual([]);
  });
});
