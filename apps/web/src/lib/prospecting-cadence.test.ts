import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { EMPTY_MARKETING_PROFILE, DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { processDueProspectingEmailDrafts } from './prospecting-cadence';
import { leadOutreachContext } from './lead-outreach-context';
import { draftSequenceStep } from './outreach-ai';
import { resolveOutboundEmailRecipient } from './message-delivery';

vi.mock('./lead-outreach-context', () => ({ leadOutreachContext: vi.fn() }));
vi.mock('./outreach-ai', () => ({ draftSequenceStep: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn(), agencyEnabled: () => false }));
vi.mock('./gmail-provider', () => ({ getOwnGmailConnection: vi.fn() }));
vi.mock('./message-delivery', () => ({ resolveOutboundEmailRecipient: vi.fn() }));

const leadId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const cadenceId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const touchId = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
const actorId = '168413e9-a6a4-4dff-a8bf-8f8df83dace9';
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function database(touchNumber = 2, saved = true) {
  const mutations: Array<{ name: string; body: Record<string, unknown> }> = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const name = url.pathname.split('/').pop() ?? '';
      if (init?.method === 'POST') {
        if (name === 'prospecting_contact_block') return json(null);
        mutations.push({ name, body: JSON.parse(String(init.body)) });
        return json(name === 'create_prospecting_email_draft' ? saved : null);
      }
      if (name === 'prospecting_cadence_touches') {
        return json(url.searchParams.has('channel') && !url.searchParams.has('touch_number') ? [{
          id: touchId, cadence_id: cadenceId, touch_number: touchNumber, due_at: '2026-11-01T16:00:00Z',
        }] : []);
      }
      if (name === 'prospecting_cadences') return json({
        id: cadenceId, lead_id: leadId, agent_user_id: actorId, gmail_connection_id: null, status: 'active', started_at: '2026-11-01T16:00:00Z',
      });
      if (name === 'leads') return json({ id: leadId, full_name: 'Synthetic Fleet', email: 'synthetic@example.invalid', status: 'new' });
      return json({ message: `Unexpected table ${name}` }, 500);
    } },
  });
  return { client, mutations };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({
    ok: true, recipient: { to: 'synthetic@example.invalid', leadId, clientId: null },
  });
  vi.mocked(leadOutreachContext).mockResolvedValue({
    workspace_assets: [], workspace_notes: [], marketing_profile: EMPTY_MARKETING_PROFILE,
    outreach_sender: DEFAULT_OUTREACH_SENDER, recent_conversation: [],
  });
  vi.mocked(draftSequenceStep).mockResolvedValue({ subject: 'Fleet review', body: 'Synthetic draft', cited_signals: ['11 power units'] });
});

describe('approval-only prospecting email generation', () => {
  it('uses the cold opening on the first email and atomically saves a draft without sending', async () => {
    const { client, mutations } = database();
    expect(await processDueProspectingEmailDrafts(client)).toEqual({ drafted: 1, skipped: 0 });
    expect(draftSequenceStep).toHaveBeenCalledWith(
      expect.objectContaining({ marketing_profile: expect.objectContaining({ template: 'cold_prospecting' }) }), 1, 4, [],
    );
    expect(mutations).toEqual([{
      name: 'create_prospecting_email_draft',
      body: { p_touch: touchId, p_to: 'synthetic@example.invalid', p_subject: 'Fleet review', p_body: 'Synthetic draft', p_signals: ['11 power units'] },
    }]);
  });
  it('maps touch seven to email four and respects a concurrent stop or duplicate draft', async () => {
    const { client, mutations } = database(7, false);
    expect(await processDueProspectingEmailDrafts(client)).toEqual({ drafted: 0, skipped: 1 });
    expect(draftSequenceStep).toHaveBeenCalledWith(expect.anything(), 4, 4, []);
    expect(mutations).toHaveLength(1);
  });
  it('stops blocked plans before calling AI', async () => {
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({
      ok: false, status: 403, code: 'do_not_contact', message: 'Do not contact.',
    });
    const { client, mutations } = database();
    expect(await processDueProspectingEmailDrafts(client)).toEqual({ drafted: 0, skipped: 1 });
    expect(draftSequenceStep).not.toHaveBeenCalled();
    expect(mutations).toEqual([{
      name: 'stop_prospecting_cadence', body: { p_cadence: cadenceId, p_status: 'do_not_contact', p_reason: 'Do not contact.' },
    }]);
  });
  it('surfaces preference verification failures without creating a draft', async () => {
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({
      ok: false, status: 503, code: 'unavailable', message: 'Preferences unavailable.',
    });
    const { client, mutations } = database();
    await expect(processDueProspectingEmailDrafts(client)).rejects.toThrow('Preferences unavailable.');
    expect(draftSequenceStep).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });
});
