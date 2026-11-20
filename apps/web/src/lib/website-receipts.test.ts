import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { websiteSubmissionReceipts } from './website-receipts';
import { POST } from '../app/api/leads/route';
import { GET as syncLeads } from '../app/api/cron/sync-leads/route';
import { getSupabaseServerClient } from './supabase-server';
import { getApiSession } from './api-auth';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), requireApiSession: vi.fn().mockResolvedValue(null) }));
vi.mock('./automation-health', () => ({
  trackedAutomation: async (_db: unknown, job: string, run: () => Promise<Record<string, unknown>>) => ({
    job, ...(job === 'website-intake' ? await run() : { status: 'succeeded', summary: {} }),
  }),
}));

let calls: Array<{ path: string; body: Record<string, unknown> }>;
let lookup: (payloads: Record<string, unknown>[]) => Response;
let role: string;
const teamAccess: { mode: 'restricted'; grants: Record<string, unknown> } = {
  mode: 'restricted', grants: { 'automation.manage': 'agency' },
};
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const leadId = 'c5b14c2b-5527-4a2d-b395-e0a04a4f6dd2';
const user: User = { id: leadId, aud: 'authenticated', created_at: '2026-11-05T00:00:00Z', app_metadata: {}, user_metadata: {} };
function db() {
  return createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/agency_members')) return json({ user_id: user.id, role, active: true });
      if (url.pathname.endsWith('/website_submission_receipts_for')) return lookup(body.p_payloads as Record<string, unknown>[]);
      return json({ message: 'Unexpected write after processed submission' }, 500);
    } }, auth: { persistSession: false, autoRefreshToken: false },
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  teamAccess.grants = { 'automation.manage': 'agency' };
  calls = []; role = 'owner'; lookup = () => json([]); vi.mocked(getSupabaseServerClient).mockReturnValue(db());
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('durable website receipt lookup', () => {
  it.each(['owner', 'cron'])('a %s full-history pull skips processed active, archived, deleted and no-id requests without generating work', async (authorization) => {
    vi.stubEnv('WEBSITE_SYNC_TOKEN', 'test-token');
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([
      { id: '1', full_name: 'Processed active' }, { id: '2', full_name: 'Processed archived' },
      { id: '3', full_name: 'Deleted' }, { full_name: 'Old no-id request', submitted_at: '2020-01-01T10:00:00Z' },
    ])));
    lookup = (payloads) => json(payloads.map((_, position) => ({ position, lead_id: position % 2 === 0 ? null : leadId })));
    const response = await syncLeads(new NextRequest('http://localhost/api/cron/sync-leads', {
      headers: authorization === 'cron' ? { Authorization: 'Bearer test-cron-secret' } : {},
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runs: expect.arrayContaining([
      expect.objectContaining({ job: 'website-intake', summary: { ok: true, pulled: 4, inserted: 0, resubmissions: 0, skippedExisting: 4 } }),
    ]) });
    expect(calls.map((call) => call.path)).toEqual(['/rest/v1/rpc/website_submission_receipts_for']);
    expect(getApiSession).toHaveBeenCalledTimes(authorization === 'owner' ? 1 : 0);
  });
  it.each(['admin', 'agent'])('rejects %s full-history pulls before fetching submissions or generating work', async (memberRole) => {
    role = memberRole;
    teamAccess.grants = {};
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    const fetchExport = vi.fn();
    vi.stubGlobal('fetch', fetchExport);
    const response = await syncLeads(new NextRequest('http://localhost/api/cron/sync-leads'));
    expect(response.status).toBe(403);
    expect(fetchExport).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it('distinguishes a purged receipt from an unseen request and batches beyond 100', async () => {
    lookup = (payloads) => json(payloads.map((_, position) => ({ position, lead_id: position === 0 ? null : leadId })));
    const receipts = await websiteSubmissionReceipts(db(), Array.from({ length: 201 }, (_, id) => ({ id })));
    expect(receipts.size).toBe(201);
    expect(receipts.has(0)).toBe(true);
    expect(receipts.get(0)).toBeNull();
    expect(receipts.has(201)).toBe(false);
    expect(calls.map((call) => (call.body.p_payloads as unknown[]).length)).toEqual([100, 100, 1]);
  });
  it.each([null, [{ position: -1, lead_id: null }], [{ position: 1, lead_id: null }]])('rejects invalid lookup results %j', async (data) => {
    lookup = () => json(data);
    await expect(websiteSubmissionReceipts(db(), [{}])).rejects.toThrow('invalid');
  });
  it('reports lookup failure rather than treating all historical records as new', async () => {
    lookup = () => json({ message: 'Lookup unavailable', code: '08006' }, 503);
    await expect(websiteSubmissionReceipts(db(), [{}])).rejects.toThrow();
  });
  it.each([leadId, null])('direct replay returns a duplicate without matching, restoring or inserting (lead %s)', async (id) => {
    lookup = () => json([{ position: 0, lead_id: id }]);
    const response = await POST(new NextRequest('http://localhost/api/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Old request', id: 'historical-submission' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, duplicate: true });
    expect(calls).toHaveLength(1);
  });
});
