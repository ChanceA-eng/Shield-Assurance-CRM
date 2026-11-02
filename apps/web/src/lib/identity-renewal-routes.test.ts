import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { requireApiSession } from './api-auth';
import { POST as issue, PATCH as change } from '../app/api/policies/route';
import { POST as merge } from '../app/api/leads/merge/route';
import { GET as eligibleLeads } from '../app/api/policies/identity/route';
import { GET as prefill } from '../app/api/policies/prefill/route';
import { runRenewalRadar } from './renewal-automation';
import { policyIdentity, policyFields } from './policy-identity';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ requireApiSession: vi.fn() }));
vi.mock('./automation', () => ({ writeNotification: vi.fn(), writeCommunicationLog: vi.fn() }));
vi.mock('./messaging', () => ({ sendEmail: vi.fn() }));

const account = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const lead = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const policy = {
  id: lead, client_id: account, account_id: account, insured_name: 'Shared name', carrier: 'Carrier',
  line_of_business: 'Auto', premium: 1000, policy_number: 'A1', effective_date: '2026-01-01',
  renewal_date: '2026-11-20', expiration_date: '2026-11-20', status: 'issued', carrier_confirmed: true,
};
const calls: Array<{ path: string; body: Record<string, unknown> | null; url: URL }> = [];
let respond: (path: string, body: Record<string, unknown> | null, url: URL) => Response;
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
function request(body: unknown, path = '/api/policies', method = 'POST'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method, body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' } });
}
function client() {
  return createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ path: url.pathname, body, url });
      return respond(url.pathname, body, url);
    } },
  });
}
beforeEach(() => {
  calls.length = 0;
  vi.mocked(requireApiSession).mockResolvedValue(null);
  vi.mocked(getSupabaseServerClient).mockReturnValue(client());
  respond = (path) => {
    if (path.endsWith('/issue_policy_with_assets_atomic')) return json({ policy, created: false });
    if (path.endsWith('/update_policy_atomic')) return json({ policy });
    if (path.endsWith('/reconcile_legacy_renewal_tasks')) return json(0);
    if (path.endsWith('/policies')) return json([]);
    return json({ message: `Unexpected path ${path}` }, 500);
  };
});

describe('policy identity and placement', () => {
  it('passes explicit insured asset selections to the atomic issuance boundary', async () => {
    const assetId = 'c3db2f75-a682-4d14-8c76-693b4f123456';
    const result = await issue(request({ ...policy, insured_asset_ids: [assetId] }));
    expect(result.status).toBe(201);
    expect(calls[0].path).toContain('/issue_policy_with_assets_atomic');
    expect(calls[0].body).toMatchObject({ p_account_id: account, p_asset_ids: [assetId] });
  });
  it.each([[['invalid']], [[lead, lead]], [Array.from({ length: 101 }, () => lead)]])('rejects invalid or repeated insured assets before issuance', async (assetIds) => {
    const result = await issue(request({ ...policy, insured_asset_ids: assetIds }));
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('routes selected quote issuance through the atomic linkage RPC and does not accept malformed quote versions', async () => {
    respond = (path) => path.endsWith('/issue_policy_with_assets_atomic') ? json({ policy, created: false })
      : path.endsWith('/policies') ? json([]) : json(0);
    const response = await issue(request({ ...policy, quote_id: lead, quote_version: '2026-11-02T21:00:00Z' }));
    expect(response.status).toBe(201);
    expect(calls[0].path).toContain('issue_policy_with_assets_atomic');
    expect(calls[0].body).toMatchObject({ p_quote_id: lead, p_quote_version: '2026-11-02T21:00:00Z', p_asset_ids: [] });
    calls.length = 0;
    expect((await issue(request({ ...policy, quote_id: lead, quote_version: 'invalid' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('prefills only an accepted account-scoped quote and includes its exact version', async () => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account name' })
      : path.endsWith('/quote_options') ? json({ id: lead, client_id: account, lead_id: null, status: 'accepted',
        carrier: 'Quote carrier', premium: '456.78', line_of_business: 'Commercial Auto', updated_at: '2026-11-02T21:00:00Z',
        effective_date: '2026-11-02', expiration_date: '2027-11-02', limits: 'Quote limits', deductibles: '500' })
      : json(null);
    const response = await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&quote_id=${lead}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quote_id: lead, quote_version: '2026-11-02T21:00:00Z',
      carrier: 'Quote carrier', premium: '456.78', line_of_business: 'Commercial Auto' });
    expect(calls.find((call) => call.path.endsWith('/quote_options'))?.url.searchParams.get('client_id')).toBe(`eq.${account}`);
  });
  it.each(['draft', 'presented', 'declined'])('blocks %s quote handoff', async (status) => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account' })
      : json({ id: lead, client_id: account, status });
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&quote_id=${lead}`))).status).toBe(409);
  });
  it('blocks a quote already placed and never mutates anything in prefill', async () => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account' })
      : path.endsWith('/quote_options') ? json({ id: lead, client_id: account, status: 'accepted' }) : json({ id: lead });
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&quote_id=${lead}`))).status).toBe(409);
    expect(calls.every((call) => call.body === null)).toBe(true);
  });
  it('prefills only the explicitly selected linked lead and never invents carrier or premium', async () => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account name', email: 'account@example.invalid' })
      : json({ id: lead, account_id: account, full_name: 'Lead insured', email: 'lead@example.invalid', phone: '555', address: 'Street', line_of_business: 'Auto', status: 'quoted' });
    const response = await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&lead_id=${lead}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account_id: account, account_name: 'Account name', lead_id: lead,
      insured_name: 'Lead insured', email: 'lead@example.invalid', phone: '555', address: 'Street', line_of_business: 'Auto' });
    expect(calls.map((call) => call.url.searchParams.get('id'))).toEqual([`eq.${account}`, `eq.${lead}`]);
    expect(calls.every((call) => call.body === null)).toBe(true);
  });
  it('prefills an account without silently selecting or completing a lead', async () => {
    respond = () => json({ id: account, full_name: 'Account name', email: null, phone: null, address: null });
    const response = await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lead_id: null, email: '', phone: '', address: '', insured_name: 'Account name' });
    expect(calls).toHaveLength(1);
  });
  it('prefills a renewal from the exact previous term without copying its dates or policy number', async () => {
    respond = (path) => path.endsWith('/clients')
      ? json({ id: account, full_name: 'Account name', email: 'account@example.invalid' })
      : json({ id: lead, client_id: account, insured_name: 'Prior insured', carrier: 'Prior carrier',
        line_of_business: 'Commercial Auto', sub_type: 'Fleet', premium: '2300', policy_number: 'OLD-1',
        effective_date: '2025-01-01', expiration_date: '2026-01-01', renewal_date: '2026-01-01' });
    const response = await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&renew_from_id=${lead}`));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      account_id: account, lead_id: null, insured_name: 'Prior insured', prior_policy_id: lead,
      prior_policy_number: 'OLD-1', prior_expiration_date: '2026-01-01', carrier: 'Prior carrier',
      line_of_business: 'Commercial Auto', premium: '2300', sub_type: 'Fleet',
    });
    expect(result).not.toHaveProperty('effective_date');
    expect(result).not.toHaveProperty('policy_number');
    const priorQuery = calls.find((call) => call.path.endsWith('/policies'))!;
    expect(priorQuery.url.searchParams.get('id')).toBe(`eq.${lead}`);
    expect(priorQuery.url.searchParams.get('client_id')).toBe(`eq.${account}`);
  });
  it('rejects renewal prefill for another account and conflicting lead/quote context', async () => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account' }) : json(null);
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&renew_from_id=${lead}`))).status).toBe(404);
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&renew_from_id=${lead}&lead_id=${lead}`))).status).toBe(400);
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&renew_from_id=${lead}&quote_id=${lead}`))).status).toBe(400);
  });
  it('requires a prior policy linked to the selected account during issuance', async () => {
    const body = { ...policy, prior_policy_id: lead, request_id: account };
    respond = (path) => path.endsWith('/policies') ? json(null) : json({ message: 'Unexpected request' }, 500);
    const response = await issue(request(body));
    expect(response.status).toBe(409);
    expect(calls.some((call) => call.path.endsWith('/issue_policy_with_assets_atomic'))).toBe(false);
  });
  it.each([null, lead])('rejects a lead linked to %s instead of guessing account identity', async (account_id) => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account' })
      : json({ id: lead, full_name: 'Lead', account_id, status: 'new' });
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&lead_id=${lead}`))).status).toBe(409);
  });
  it('rejects terminal leads, missing accounts and malformed identities explicitly', async () => {
    respond = (path) => path.endsWith('/clients') ? json({ id: account, full_name: 'Account' })
      : json({ id: lead, account_id: account, status: 'won' });
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}&lead_id=${lead}`))).status).toBe(409);
    respond = () => json(null);
    expect((await prefill(new NextRequest(`http://localhost/api/policies/prefill?account_id=${account}`))).status).toBe(404);
    calls.length = 0;
    expect((await prefill(new NextRequest('http://localhost/api/policies/prefill?account_id=invalid'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('requires explicit carrier confirmation before any policy write', async () => {
    for (const carrier_confirmed of [undefined, false, 'true']) {
      expect((await issue(request({ ...policy, carrier_confirmed }))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
  it('does not infer an account from name, email or phone', async () => {
    expect((await issue(request({ ...policy, account_id: undefined, client_id: undefined }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('rejects conflicting aliases and malformed lead IDs', () => {
    expect(() => policyIdentity({ account_id: account, client_id: lead })).toThrow('same account');
    expect(() => policyIdentity({ account_id: account, lead_id: 'guessed name' })).toThrow('valid lead');
  });
  it('issues through one atomic RPC with explicit optional lead and no contact writes', async () => {
    const res = await issue(request({ ...policy, lead_id: lead, request_id: account }));
    expect(res.status).toBe(201);
    expect(calls[0].body).toMatchObject({ p_request_id: account, p_account_id: account, p_lead_id: lead });
    expect(calls.every((call) => call.path.includes('/rpc/') || call.path.endsWith('/policies'))).toBe(true);
    expect(calls.some((call) => call.path.endsWith('/clients') || call.path.endsWith('/leads'))).toBe(false);
  });
  it('does not complete any lead when no lead was explicitly supplied', async () => {
    await issue(request(policy));
    expect(calls[0].body?.p_lead_id).toBeNull();
  });
  it('PATCH updates only policy fields and normalizes dates without clearing omitted contacts', async () => {
    expect(policyFields({ insured_name: ' Other name ', renewal_date: '2027-01-01' }))
      .toEqual({ insured_name: 'Other name', renewal_date: '2027-01-01', expiration_date: '2027-01-01' });
    expect((await change(request({ id: lead, insured_name: 'Other name' }, '/api/policies', 'PATCH'))).status).toBe(200);
    expect(calls[0].body).toEqual({ p_id: lead, p_updates: { insured_name: 'Other name' } });
  });
  it('reports a saved policy with explicit retry warning if radar persistence fails', async () => {
    respond = (path) => path.endsWith('/issue_policy_with_assets_atomic') ? json({ policy, created: false })
      : json({ message: 'Migration unavailable', code: 'PGRST202' }, 404);
    const res = await issue(request(policy));
    expect(res.status).toBe(201);
    expect((await res.json() as { warnings: string[] }).warnings[0]).toContain('Policy saved; renewal radar failed');
  });
  it('fails closed when transactional functions are unavailable', async () => {
    respond = () => json({ message: 'Missing migration', code: 'PGRST202' }, 404);
    expect((await issue(request(policy))).status).toBe(503);
    expect(calls).toHaveLength(1);
  });
  it('returns a conflict for different linked accounts', async () => {
    respond = () => json({ message: 'Different accounts', code: '23514' }, 400);
    expect((await issue(request({ ...policy, lead_id: lead }))).status).toBe(409);
  });
  it('filters eligible leads by explicit account, active state and escaped search', async () => {
    respond = () => json([]);
    const res = await eligibleLeads(new NextRequest(`http://localhost:3000/api/policies/identity?account_id=${account}&q=Same%25`));
    expect(res.status).toBe(200);
    expect(calls[0].url.searchParams.get('or')).toContain(`account_id.eq.${account}`);
    expect(calls[0].url.searchParams.get('full_name')).toBe('ilike.%Same\\%%');
  });
});

describe('atomic merge contract', () => {
  it('sends the whole operation to the database and never pre-mutates children', async () => {
    respond = () => json({ ok: true, survivor_id: account, merged: 1 });
    expect((await merge(request({ survivor_id: account, merge_ids: [lead, lead], fields: { email: null } }, '/api/leads/merge'))).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toContain('/rpc/merge_leads_atomic');
    expect(calls[0].body).toEqual({ p_survivor_id: account, p_merge_ids: [lead], p_fields: { email: null } });
  });
  it('returns missing-lead errors instead of merging a partial subset', async () => {
    respond = () => json({ message: 'Lead missing', code: 'P0002' }, 400);
    expect((await merge(request({ survivor_id: account, merge_ids: [lead] }, '/api/leads/merge'))).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe('database-backed renewal radar', () => {
  it('uses atomic term/milestone persistence and actual database counters', async () => {
    respond = (path) => path.endsWith('/policies') ? json([policy])
      : path.endsWith('/persist_renewal_radar') ? json({ tasksCreated: 0, tasksEscalated: 1, notifications: 0 }) : json(0);
    expect(await runRenewalRadar(client(), new Date('2026-11-10T17:00:00Z'))).toEqual({
      policies: 1, tasksCreated: 0, tasksEscalated: 1, notifications: 0,
    });
    expect(calls.find((call) => call.path.endsWith('/persist_renewal_radar'))?.body).toMatchObject({
      p_policy_id: lead, p_renewal_date: '2026-11-20', p_milestone: 15,
    });
    expect(calls.some((call) => call.path.endsWith('/tasks') || call.path.endsWith('/notifications'))).toBe(false);
  });
  it.each(['reconcile_legacy_renewal_tasks', 'policies', 'persist_renewal_radar'])('throws explicit persistence failures from %s', async (broken) => {
    respond = (path) => path.endsWith(`/${broken}`) ? json({ message: 'Database failure' }, 500)
      : path.endsWith('/policies') ? json([policy]) : json(0);
    await expect(runRenewalRadar(client(), new Date('2026-11-10T17:00:00Z'))).rejects.toThrow('Database failure');
  });
  it('paginates rather than silently ignoring policies after the first 500', async () => {
    respond = (path, _body, url) => path.endsWith('/policies')
      ? json(url.searchParams.get('offset') === '0' ? Array.from({ length: 500 }, () => ({ ...policy, client_id: null, account_id: null })) : [])
      : json(0);
    await runRenewalRadar(client(), new Date('2026-11-10T17:00:00Z'));
    expect(calls.filter((call) => call.path.endsWith('/policies'))).toHaveLength(2);
  });
});
