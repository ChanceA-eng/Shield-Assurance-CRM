import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  role: 'agent', revision: 1,
  teamAccess: { mode: 'restricted' as const, grants: {} as Record<string, unknown> },
  rpc: vi.fn(async (_name: string, _values: object) => ({ data: { saved: true }, error: null })),
  filter: vi.fn((_table: string, _column: string, _value: string) => {}),
  publish: vi.fn(async () => 'published'), withdraw: vi.fn(async () => {}),
}));
const actor = '65472c9e-dbf5-4e22-ac93-6328285eff91';
const id = '0b961bce-ad74-4822-a176-7d416d93489b';
const input = {
  id, revision: 0, account_id: 'd0b0cd9e-31fb-4a1e-99ab-cd33220adca5',
  carrier: 'Example Carrier', form_number: 'CG 00 01', edition: '04 13', jurisdiction: 'Arizona',
  line_of_business: 'General liability',
  wording: 'This insurance does not apply to bodily injury expected or intended from the standpoint of the insured.',
  privacy_confirmed: true, rights_confirmed: true,
};
vi.mock('../../../lib/api-auth', () => ({ getApiSession: async () => ({
  user: { id: actor }, error: null, teamAccess: state.teamAccess,
}) }));
vi.mock('../../../lib/rashi-server', () => ({
  publishReviewedPolicyWording: state.publish, withdrawReviewedPolicyWording: state.withdraw,
}));
vi.mock('../../../lib/supabase-server', () => ({
  getSupabaseServerClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const row = table === 'agency_members' ? { user_id: actor, role: state.role, active: true }
        : table === 'clients' ? { id: input.account_id, full_name: 'Synthetic Private Customer', email: 'private@example.invalid', phone: '+15205550100', address: '123 Test Street' }
          : { ...input, revision: state.revision };
      const result = { data: table === 'policies' ? [] : [row], count: 0, error: null };
      const query = {
        select: () => query, eq: (column: string, value: string) => { state.filter(table, column, value); return query; },
        order: () => query, limit: () => query, range: () => query,
        single: async () => ({ data: row, error: null }), maybeSingle: async () => ({ data: row, error: null }),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
  }),
}));
import { GET, POST, PATCH } from './route';
function request(body: object, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/policy-knowledge', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => {
  vi.clearAllMocks(); state.role = 'agent'; state.revision = 1;
  state.teamAccess = { mode: 'restricted', grants: { 'knowledge.view': 'agency', 'knowledge.edit': 'agency' } };
});
describe('policy knowledge API authorization and privacy', () => {
  it('uses the authenticated actor and never indexes a submission', async () => {
    const response = await POST(request({ ...input, actor: id }));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('save_policy_knowledge_candidate', expect.objectContaining({ p_actor: actor, p_expected: 0 }));
    expect(state.publish).not.toHaveBeenCalled();
  });
  it('rejects missing review or reuse permission without saving', async () => {
    expect((await POST(request({ ...input, privacy_confirmed: false }))).status).toBe(400);
    expect((await POST(request({ ...input, rights_confirmed: false }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('blocks known private account identifiers before saving or publishing', async () => {
    const response = await POST(request({ ...input, wording: `${input.wording} Applies to Synthetic Private Customer.` }));
    expect(response.status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled();
  });
  it('denies agent approval, publication and withdrawal even when buttons are bypassed', async () => {
    state.teamAccess = { mode: 'restricted', grants: { 'knowledge.view': 'agency' } };
    for (const action of ['approve', 'publish', 'withdraw']) {
      expect((await PATCH(request({ ...input, revision: 1, action }, 'PATCH'))).status).toBe(403);
    }
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled(); expect(state.withdraw).not.toHaveBeenCalled();
  });
  it('approves only the loaded owner-reviewed revision and rejects stale versions', async () => {
    state.role = 'owner';
    const response = await PATCH(request({ ...input, revision: 1, action: 'approve' }, 'PATCH'));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('review_policy_knowledge_candidate', {
      p_actor: actor, p_id: id, p_expected: 1, p_approve: true,
    });
    state.revision = 2; state.rpc.mockClear();
    expect((await PATCH(request({ ...input, revision: 1, action: 'approve' }, 'PATCH'))).status).toBe(409);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('returns a private uncached list and owner capability from current membership', async () => {
    state.teamAccess = { mode: 'restricted', grants: { 'knowledge.view': 'agency' } };
    const response = await GET(new NextRequest('http://localhost/api/policy-knowledge'));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).can_review).toBe(false);
    expect(state.filter).toHaveBeenCalledWith('policy_knowledge_candidates', 'created_by', actor);
  });
});
