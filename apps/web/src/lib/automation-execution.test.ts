import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { BUILT_IN_AUTOMATION_DEFAULTS, DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET as preview, POST as run } from '../app/api/automation/run/route';
import { POST as heartbeat } from '../app/api/cron/heartbeat/route';
import { GET as outreachCron } from '../app/api/cron/outreach/route';
import { GET as scheduler, PATCH as changeScheduler } from '../app/api/settings/automation/scheduler/route';
import { processDueEnrollments } from './outreach-engine';
import { GET as syncJobs } from '../app/api/cron/sync-leads/route';
import { GET as scheduledJobs } from '../app/api/messages/process-scheduled/route';
import { runWorkflowAutomation } from './workflow-execution';
import { processAgentScheduled } from './agent-scheduled';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./outreach-engine', () => ({ processDueEnrollments: vi.fn() }));
vi.mock('../app/api/cron/sync-leads/route', () => ({ GET: vi.fn() }));
vi.mock('../app/api/messages/process-scheduled/route', () => ({ GET: vi.fn() }));
vi.mock('./workflow-execution', () => ({ runWorkflowAutomation: vi.fn() }));
vi.mock('./agent-scheduled', () => ({ processAgentScheduled: vi.fn() }));
const user: User = { id: 'c5b14c2b-5527-4a2d-b395-e0a04a4f6dd2', aud: 'authenticated', created_at: '2026-11-05T00:00:00Z', app_metadata: {}, user_metadata: {} };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let role: string;
let gmailCursor: string | null;
let calls: Array<{ path: string; method: string; body: unknown }>;
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); role = 'owner'; calls = []; gmailCursor = null;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(processDueEnrollments).mockResolvedValue({ drafted: 0, autoSent: 0, skipped: 0 });
  vi.mocked(processAgentScheduled).mockResolvedValue({ sent: 0, blocked: 0 });
  vi.mocked(runWorkflowAutomation).mockResolvedValue({ status: 'succeeded', summary: { succeeded: 1, failed: 0, skipped: 0 } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ path: url.pathname, method: init?.method ?? 'GET', body });
      if (url.pathname.endsWith('/agency_members')) return json({ user_id: user.id, role, active: true });
      if (url.pathname.endsWith('/outreach_settings')) return json({ configuration_revision: 2, automation_configuration: BUILT_IN_AUTOMATION_DEFAULTS,
        approval_mode: true, daily_send_cap: 20, send_window_start: 8, send_window_end: 17, sender_profile: DEFAULT_OUTREACH_SENDER, opt_out_footer: 'Test footer' });
      if (url.pathname.endsWith('/preview_automation_job')) return json({ revision: 2, job: 'follow-up-routine', records: 3, preview_only: true });
      if (url.pathname.endsWith('/workflow_rule_revision')) return json(4);
      if (url.pathname.endsWith('/ensure_default_followups')) return json(3);
      if (url.pathname.endsWith('/crm_scheduler_status')) return json({ configured: true, jobs: [] });
      if (url.pathname.endsWith('/configure_crm_scheduler')) return json({ configured: true, jobs: [] });
      if (url.pathname.endsWith('/automation_runs')) return json({ id: user.id,
        ...(init?.method === undefined || init.method === 'GET' ? { summary: { sequences: { next_cursor: gmailCursor } } } : {}),
        ...(body && typeof body === 'object' ? body : {}) });
      return json({ message: 'Unexpected request' }, 400);
    } },
  }));
});
const post = (body: unknown): NextRequest => new NextRequest('http://localhost/api/automation/run', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('scoped automation execution', () => {
  it('preview only calls the stable counting function, never business executors', async () => {
    const response = await preview(new NextRequest('http://localhost/api/automation/run?job=follow-up-routine'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ records: 3, preview_only: true });
    expect(calls.map((call) => call.path)).toEqual(['/rest/v1/agency_members', '/rest/v1/rpc/preview_automation_job']);
    expect(processDueEnrollments).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'all', 'website-intake'])('rejects unsupported bundled job %s', async (job) => {
    expect((await preview(new NextRequest(`http://localhost/api/automation/run?job=${job}`))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it('rejects unconfirmed runs and stale previews before execution', async () => {
    expect((await run(post({ job: 'follow-up-routine', expected_revision: 2 }))).status).toBe(400);
    calls = [];
    expect((await run(post({ job: 'outreach', expected_revision: 1, confirmed: true }))).status).toBe(409);
    expect(calls.some((call) => call.path.includes('/automation_runs'))).toBe(false);
    expect(processDueEnrollments).not.toHaveBeenCalled();
  });
  it('runs just the confirmed internal job and records its start and finish', async () => {
    expect((await run(post({ job: 'follow-up-routine', expected_revision: 2, confirmed: true }))).status).toBe(200);
    expect(calls.filter((call) => call.path.endsWith('/automation_runs')).map((call) => call.method)).toEqual(['POST', 'PATCH']);
    expect(calls.filter((call) => call.path.includes('/rpc/')).map((call) => call.path)).toEqual(['/rest/v1/rpc/ensure_default_followups']);
    expect(processDueEnrollments).not.toHaveBeenCalled();
  });
  it('requires the separate custom-rule revision and rejects stale custom previews before claiming work', async () => {
    expect((await run(post({ job: 'custom-workflows', expected_revision: 2, confirmed: true }))).status).toBe(400);
    expect((await run(post({ job: 'custom-workflows', expected_revision: 2, expected_workflow_revision: 3, confirmed: true }))).status).toBe(409);
    expect(runWorkflowAutomation).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path.endsWith('/automation_runs'))).toBe(false);
  });
  it('runs only the confirmed custom job and preserves partial results', async () => {
    vi.mocked(runWorkflowAutomation).mockResolvedValue({ status: 'partial', summary: { succeeded: 0, failed: 1, skipped: 0 }, error: 'Review failed rule' });
    const result = await run(post({ job: 'custom-workflows', expected_revision: 2, expected_workflow_revision: 4, confirmed: true }));
    expect(result.status).toBe(207);
    expect(runWorkflowAutomation).toHaveBeenCalledWith(expect.anything(), user.id);
    expect(processDueEnrollments).not.toHaveBeenCalled();
    expect(await result.json()).toMatchObject({ ok: false, run: { status: 'partial', error: 'Review failed rule' } });
  });
  it.each(['admin', 'agent'])('blocks %s previews, execution and scheduler mutation', async (value) => {
    role = value;
    expect((await preview(new NextRequest('http://localhost/api/automation/run?job=outreach'))).status).toBe(403);
    expect((await run(post({ job: 'outreach', expected_revision: 2, confirmed: true }))).status).toBe(403);
    expect((await changeScheduler(new NextRequest('http://localhost/api/settings/automation/scheduler', {
      method: 'PATCH', body: JSON.stringify({ enabled: false }),
    }))).status).toBe(403);
    expect(calls.every((call) => call.path.endsWith('/agency_members'))).toBe(true);
  });
  it('reads scheduler status privately and validates scheduling changes', async () => {
    const response = await scheduler(new NextRequest('http://localhost/api/settings/automation/scheduler'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    calls = [];
    expect((await changeScheduler(new NextRequest('http://localhost/api/settings/automation/scheduler', {
      method: 'PATCH', body: JSON.stringify({ enabled: 'false' }),
    }))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
describe('server heartbeat authorization', () => {
  it('continues the Gmail sequence cursor so earlier deferred sequences cannot starve later approvals', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    gmailCursor = user.id;
    const result = await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify({ job: 'personal-gmail' }) }));
    expect(result.status).toBe(200);
    expect(processDueEnrollments).toHaveBeenCalledWith(expect.anything(), { limit: 1, after: user.id, gmailOnly: true });
  });
  it('runs only bounded personal Gmail schedules and reviewed Gmail sequences, never general automations', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    const result = await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify({ job: 'personal-gmail' }) }));
    expect(result.status).toBe(200);
    expect(processAgentScheduled).toHaveBeenCalledWith(expect.anything(), 1);
    expect(processDueEnrollments).toHaveBeenCalledWith(expect.anything(), { limit: 1, after: null, gmailOnly: true });
    expect(syncJobs).not.toHaveBeenCalled();
    expect(scheduledJobs).not.toHaveBeenCalled();
    expect(runWorkflowAutomation).not.toHaveBeenCalled();
    expect(await result.json()).toMatchObject({ ok: true, run: { status: 'succeeded', summary: { schedules: { sent: 0, blocked: 0 } } } });
  });
  it('reports blocked personal Gmail schedules as needing review', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    vi.mocked(processAgentScheduled).mockResolvedValue({ sent: 0, blocked: 1 });
    const result = await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify({ job: 'personal-gmail' }) }));
    expect(result.status).toBe(207);
    expect(await result.json()).toMatchObject({ ok: false, run: { status: 'partial', error: 'A Gmail schedule needs review.' } });
  });
  it.each(['', 'configured-secret'])('does not accept an unauthenticated heartbeat or outreach cron with secret %s', async (secret) => {
    vi.stubEnv('CRON_SECRET', secret);
    expect((await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await outreachCron(new NextRequest('http://localhost/api/cron/outreach'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('verifies matching live credentials without invoking scheduled work or accessing the database', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    const response = await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: 'Bearer configured-secret' }, body: JSON.stringify({ verify_only: true }) }));
    expect(await response.json()).toEqual({ ok: true, verify_only: true });
    expect(calls).toHaveLength(0);
    expect(processDueEnrollments).not.toHaveBeenCalled();
  });
  it('rejects a bundled or unknown heartbeat before accessing the database', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    expect((await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: 'Bearer configured-secret' }, body: JSON.stringify({ job: 'all' }) }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(syncJobs).not.toHaveBeenCalled();
    expect(scheduledJobs).not.toHaveBeenCalled();
  });
  it.each(['outreach', 'scheduled-messages', 'custom-workflows'])('dispatches only the bounded %s job', async (job) => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    vi.mocked(syncJobs).mockResolvedValue(NextResponse.json({ ok: true, runs: [] }));
    vi.mocked(scheduledJobs).mockResolvedValue(NextResponse.json({ ok: true, sent: 0, failed: 0 }));
    expect((await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: 'Bearer configured-secret' }, body: JSON.stringify({ job }) }))).status).toBe(200);
    if (job !== 'scheduled-messages') {
      expect(scheduledJobs).not.toHaveBeenCalled();
      expect(vi.mocked(syncJobs).mock.calls[0][0].nextUrl.searchParams.get('bounded')).toBe('true');
      expect(vi.mocked(syncJobs).mock.calls[0][0].nextUrl.searchParams.get('job')).toBe(job);
    } else {
      expect(syncJobs).not.toHaveBeenCalled();
      expect(vi.mocked(scheduledJobs).mock.calls[0][0].nextUrl.searchParams.get('limit')).toBe('1');
    }
  });
  it('records partial scheduled processing rather than reporting a successful heartbeat', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    vi.mocked(scheduledJobs).mockResolvedValue(NextResponse.json({ ok: false, failed: 1, message: 'Recorded send needs review.' }, { status: 207 }));
    const response = await heartbeat(new NextRequest('http://localhost/api/cron/heartbeat', { method: 'POST',
      headers: { authorization: 'Bearer configured-secret' }, body: JSON.stringify({ job: 'scheduled-messages' }) }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, run: { status: 'partial', error: 'Recorded send needs review.' } });
    expect(syncJobs).not.toHaveBeenCalled();
  });
});
