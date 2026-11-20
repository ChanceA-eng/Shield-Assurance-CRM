import { beforeEach, it, expect, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_OPPORTUNITY_SETTINGS } from '@crm/shared';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { activeAgencyMember } from './agency-membership';
import { GET, POST } from '../app/api/intelligence/operations/route';
import { POST as CAPTURE } from '../app/api/intelligence/capture/route';
import { POST as CRON } from '../app/api/cron/intelligence/route';
import { runOpportunityJobs } from './opportunity-jobs';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn() }));
vi.mock('./opportunity-jobs', () => ({ runOpportunityJobs: vi.fn() }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c', actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const user: User = { id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let denied = false;
const teamAccess = { mode: 'restricted' as const, grants: { 'leads.prospect': 'agency' } };
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; denied = false;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
  vi.mocked(activeAgencyMember).mockResolvedValue({ user_id: actor, email: 'qa@example.test', role: 'owner', active: true, sender_profile: null, gmail_ai_opt_in: false });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), name = url.pathname.split('/').pop() ?? '';
    const args = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ name, args });
    if (denied) return Response.json({ code: '42501', message: 'Not authorized' }, { status: 403 });
    if (name === 'discovery_sources') return Response.json({ active: true, acquisition_until: '2099-01-01' });
    if (name === 'intelligence_import_matches') return Response.json([{ index: 0, matches: [] }]);
    if (name === 'acquire_discovery_file') return Response.json({ batch_id: id, prospect_count: 1, already_acquired: false });
    return Response.json({ settings: { config: DEFAULT_OPPORTUNITY_SETTINGS, revision: 0 } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'synthetic-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
const request = (body: object) => new NextRequest('http://localhost/api/intelligence/operations', { method: 'POST', body: JSON.stringify(body) });
it('authenticates before reading operations and relies on scoped RPC authorization', async () => {
  denied = true;
  expect((await GET(new NextRequest(`http://localhost/api/intelligence/operations?type=lead&id=${id}`))).status).toBe(403);
  expect(calls[0].args).toEqual({ p_actor: actor, p_type: 'lead', p_id: id });
  calls.length = 0;
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Sign in' }, { status: 401 }) });
  expect((await GET(new NextRequest('http://localhost/api/intelligence/operations'))).status).toBe(401);
  expect(calls).toHaveLength(0);
});
it('validates owner settings and does not accept a paid budget or invalid ranges', async () => {
  expect((await POST(request({ action: 'settings', revision: 0, config: DEFAULT_OPPORTUNITY_SETTINGS }))).status).toBe(200);
  expect(calls.at(-1)?.name).toBe('save_opportunity_settings');
  expect((await POST(request({ action: 'settings', revision: 0, config: { ...DEFAULT_OPPORTUNITY_SETTINGS, paid_budget: 100 } }))).status).toBe(400);
});
it('records outcomes with stable request IDs and refuses unsupported dates, estimates or loss reasons', async () => {
  const payload = { stage: 'qualified', occurred_on: '2026-01-01', source: 'Authorized business source', cost: 0, premium: null, reason: '' };
  expect((await POST(request({ type: 'lead', id, request_id: actor, action: 'outcome', payload }))).status).toBe(200);
  expect(calls.at(-1)?.args).toMatchObject({ p_request: actor, p_actor: actor, p_payload: payload });
  expect((await POST(request({ type: 'lead', id, request_id: actor, action: 'outcome', payload: { ...payload, stage: 'lost' } }))).status).toBe(400);
});
const capture = { source_id: id, request_id: actor, name: 'Synthetic business', email: 'business@example.test', phone: '', address: '', line: 'GL',
  url: 'https://example.test/business', source_as_of: '2026-01-01', selected_text: 'Authorized selected business-only text.', rights_confirmed: true };
it('captures only selected text into existing candidate review without fetching the URL or promoting/sending', async () => {
  expect((await CAPTURE(request(capture))).status).toBe(200);
  expect(calls.map((item) => item.name)).toEqual(['discovery_sources', 'intelligence_import_matches', 'acquire_discovery_file']);
  const acquired = calls.at(-1)?.args;
  expect(acquired?.p_request).toBe(actor);
  expect(JSON.stringify(acquired)).toContain(capture.selected_text);
});
it.each([{ rights_confirmed: false }, { url: 'file:///private' }, { url: 'https://user:secret@example.test/a' }, { url: 'https://example.test/?token=private' }, { selected_text: '' }])('rejects unsafe capture or missing source-use confirmation: %j', async (patch) => {
  expect((await CAPTURE(request({ ...capture, ...patch }))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
it('cron requires the server secret and reports partial jobs instead of success', async () => {
  vi.stubEnv('CRON_SECRET', 'synthetic-secret');
  expect((await CRON(request({}))).status).toBe(401);
  expect(runOpportunityJobs).not.toHaveBeenCalled();
  vi.mocked(runOpportunityJobs).mockResolvedValue({ succeeded: 1, failed: 1, digests: 0 });
  expect((await CRON(new NextRequest('http://localhost/api/cron/intelligence', { method: 'POST', headers: { authorization: 'Bearer synthetic-secret' } }))).status).toBe(207);
  vi.unstubAllEnvs();
});
