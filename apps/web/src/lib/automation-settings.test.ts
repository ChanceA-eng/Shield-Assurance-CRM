import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { BUILT_IN_AUTOMATION_DEFAULTS, validateAutomationConfiguration, DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { getAgencyTimeZone, parseAutomationSnapshot } from './automation-settings';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET as getAgencyTimeZoneRoute } from '../app/api/agency/time-zone/route';
import { GET, PATCH } from '../app/api/settings/automation/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const user: User = { id: 'c5b14c2b-5527-4a2d-b395-e0a04a4f6dd2', aud: 'authenticated', created_at: '2026-11-05T00:00:00Z', app_metadata: {}, user_metadata: { role: 'owner' } };
const snapshot = {
  schema_version: 1, automation: BUILT_IN_AUTOMATION_DEFAULTS,
  outreach: { approval_mode: true, daily_send_cap: 20, send_window_start: 8, send_window_end: 17, timezone: 'America/Phoenix', opt_out_footer: 'Test footer', sender_profile: DEFAULT_OUTREACH_SENDER },
};
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let role: string | null;
let fail: boolean;
let calls: URL[];
let revision: unknown;
let active: boolean;
let historyCount: number;
let conflict: boolean;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; role = 'owner'; fail = false; revision = 2; active = true; historyCount = 1; conflict = false;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); calls.push(url);
      if (url.pathname.endsWith('/agency_members')) return json(role ? { user_id: user.id, role, active } : null);
      if (fail) return json({ code: '08006', message: 'Configuration storage unavailable' }, 400);
      if (url.pathname.endsWith('/save_agency_automation_settings')) return conflict
        ? json({ code: 'PT409', message: 'Settings changed since you opened them. Reload before saving.' }, 409) : json(3);
      if (url.pathname.endsWith('/outreach_settings')) return json({ configuration_revision: revision, automation_configuration: snapshot.automation, ...snapshot.outreach });
      if (url.pathname.endsWith('/automation_configuration_versions')) return json(Array.from({ length: historyCount }, (_, index) => ({
        revision: Number(revision) - index, actor_id: user.id, recorded_at: user.created_at, configuration: snapshot,
      })));
      return json({ message: 'Unexpected query' }, 500);
    } },
  }));
});
describe('versioned automation contract', () => {
  it('loads the validated agency time zone for date-boundary services', async () => {
    const db = getSupabaseServerClient();
    if (!db) throw new Error('The test database client was not configured.');
    expect(await getAgencyTimeZone(db)).toBe('America/Phoenix');
    expect(calls.find((call) => call.pathname.endsWith('/outreach_settings'))?.searchParams.get('select')).toBe('timezone');
  });
  it('serves the agency time zone to authenticated calendar and task interfaces', async () => {
    const response = await getAgencyTimeZoneRoute(new NextRequest('http://localhost/api/agency/time-zone'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ time_zone: 'America/Phoenix' });
  });
  it('does not expose agency configuration to an inactive member', async () => {
    active = false;
    const response = await getAgencyTimeZoneRoute(new NextRequest('http://localhost/api/agency/time-zone'));
    expect(response.status).toBe(403);
    expect(calls.some((call) => call.searchParams.get('select') === 'timezone')).toBe(false);
  });
  it('validates imported renewal task gates and timing', () => {
    expect(validateAutomationConfiguration({ ...BUILT_IN_AUTOMATION_DEFAULTS,
      import_renewal: { tasks_enabled: false, task_days_before: 0 },
    }).import_renewal).toEqual({ tasks_enabled: false, task_days_before: 0 });
    for (const days of [-1, 366, 1.5, '30']) {
      expect(() => validateAutomationConfiguration({ ...BUILT_IN_AUTOMATION_DEFAULTS,
        import_renewal: { tasks_enabled: true, task_days_before: days },
      })).toThrow();
    }
  });
  it('validates owner-controlled service task wording and notification switches', () => {
    const updated = structuredClone(BUILT_IN_AUTOMATION_DEFAULTS);
    updated.service.task_templates.claim.subject = 'Follow up on {service_type} for {account_name}';
    updated.service.task_templates.claim.description = 'Review the account record.';
    updated.notifications.message_replies = false;
    expect(validateAutomationConfiguration(updated)).toMatchObject({
      service: { task_templates: { claim: updated.service.task_templates.claim } },
      notifications: { message_replies: false },
    });
    for (const subject of ['Review claim', 'Review {service_type}: {account_name} {unsupported}', 'x'.repeat(241)]) {
      const invalid = structuredClone(updated);
      invalid.service.task_templates.claim.subject = subject;
      expect(() => validateAutomationConfiguration(invalid)).toThrow();
    }
    const invalidDescription = structuredClone(updated);
    invalidDescription.service.task_templates.claim.description = 'Use {unsupported} content.';
    expect(() => validateAutomationConfiguration(invalidDescription)).toThrow();
    expect(() => validateAutomationConfiguration({ ...updated,
      notifications: { ...updated.notifications, renewals: 'false' },
    })).toThrow();
  });
  it('seeds exactly the same defaults in shared TypeScript and SQL without auto-enrollment', () => {
    const sql = readFileSync(path.resolve(process.cwd(), '..', '..', 'supabase', 'migrations', '20261105210000_service_templates_and_notification_controls.sql'), 'utf8');
    const defaults = sql.split('$defaults$')[1];
    expect(JSON.parse(defaults)).toEqual(BUILT_IN_AUTOMATION_DEFAULTS);
    expect(snapshot.automation.sequence.auto_enroll_imports).toBe(false);
    expect(snapshot.automation.sequence.auto_enroll_website).toBe(false);
  });
  it('parses valid settings without returning shared mutable defaults', () => {
    const parsed = parseAutomationSnapshot(snapshot);
    expect(parsed).toEqual(snapshot);
    parsed.automation.follow_up.statuses.push('other');
    expect(BUILT_IN_AUTOMATION_DEFAULTS.follow_up.statuses).toEqual(['new', 'contacted', 'quoted']);
  });
  it.each([
    null,
    { ...snapshot, automation: undefined },
    { ...snapshot, schema_version: 2 },
    { ...snapshot, automation: { ...snapshot.automation, unsafe_script: 'script' } },
    { ...snapshot, automation: { ...snapshot.automation, reply: { enabled: false } } },
    { ...snapshot, outreach: { ...snapshot.outreach, daily_send_cap: 201 } },
    { ...snapshot, outreach: { ...snapshot.outreach, send_window_start: 18 } },
    { ...snapshot, outreach: { ...snapshot.outreach, timezone: 'Mars/Phobos' } },
    { ...snapshot, outreach: { ...snapshot.outreach, sender_profile: null } },
  ])('rejects malformed, unsupported or unwired configuration %#', (value) => {
    expect(() => parseAutomationSnapshot(value)).toThrow();
  });
  it('returns owner-only current configuration and bounded history without running automation', async () => {
    const response = await GET(new NextRequest('http://localhost/api/settings/automation?before=3'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      revision: 2, configuration: snapshot, next_before: null,
      execution_policy: { scope: 'future_events', custom_rules: 'supported_events_and_guarded_actions', uncertain_sends: 'no_automatic_retry' },
      inventory: expect.arrayContaining([expect.objectContaining({ id: 'reply', runtime_configuration: 'saved_policy' })]),
    });
    const settings = calls.find((call) => call.pathname.endsWith('/outreach_settings'));
    expect(settings?.searchParams.get('select')).toContain('timezone');
    const history = calls.find((call) => call.pathname.endsWith('/automation_configuration_versions'));
    expect(history?.searchParams.get('limit')).toBe('20');
    expect(history?.searchParams.getAll('revision')).toEqual(['lte.2', 'lt.3']);
    expect(calls.some((call) => call.pathname.includes('/rpc/'))).toBe(false);
  });
  it.each(['admin', 'agent', null])('does not let %s read agency settings through editable metadata', async (value) => {
    role = value;
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it('rejects inactive owners', async () => {
    active = false;
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it.each([null, 0, -1, '2', 1.5, 2147483648])('reports invalid saved revision %s instead of inventing a configuration', async (value) => {
    revision = value;
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(500);
    expect(calls.some((call) => call.pathname.endsWith('/automation_configuration_versions'))).toBe(false);
  });
  it('returns a revision cursor when history fills one page', async () => {
    revision = 30; historyCount = 20;
    const response = await GET(new NextRequest('http://localhost/api/settings/automation'));
    expect(await response.json()).toMatchObject({ revision: 30, next_before: 11, history: expect.any(Array) });
  });
  it('requires authentication and reports missing database separately', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(401);
    expect(calls).toHaveLength(0);
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(503);
  });
  it('does not return default success when the configuration read fails', async () => {
    fail = true;
    expect((await GET(new NextRequest('http://localhost/api/settings/automation'))).status).toBe(500);
  });
  it.each(['', '0', '-1', '1.5', '2147483648', '1e2'])('rejects invalid history cursor %s', async (before) => {
    expect((await GET(new NextRequest(`http://localhost/api/settings/automation?before=${before}`))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it('saves valid controls through the owner-checked revision RPC only', async () => {
    const configuration = { ...snapshot.automation, reply: { ...snapshot.automation.reply, due_minutes: 45 } };
    const response = await PATCH(new NextRequest('http://localhost/api/settings/automation', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configuration, expected_revision: 2 }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 3 });
    expect(calls.map((call) => call.pathname)).toEqual(['/rest/v1/agency_members', '/rest/v1/rpc/save_agency_automation_settings']);
  });
  it('propagates a stale settings conflict without running any automation', async () => {
    conflict = true;
    const response = await PATCH(new NextRequest('http://localhost/api/settings/automation', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configuration: snapshot.automation, expected_revision: 2 }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('Reload') });
  });
  it.each(['admin', 'agent', null])('rejects a %s automation write', async (value) => {
    role = value;
    expect((await PATCH(new NextRequest('http://localhost/api/settings/automation', { method: 'PATCH',
      body: JSON.stringify({ configuration: snapshot.automation, expected_revision: 2 }) }))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it.each([
    { expected_revision: null }, { expected_revision: 0 }, { expected_revision: 2, unsafe_script: 'bad' },
    { expected_revision: 2, configuration: { ...snapshot.automation, reply: { ...snapshot.automation.reply, due_minutes: 0 } } },
  ])('rejects invalid writes before mutation %#', async (body) => {
    const response = await PATCH(new NextRequest('http://localhost/api/settings/automation', { method: 'PATCH',
      body: JSON.stringify({ configuration: snapshot.automation, ...body }) }));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it.each([0, 24, 2.5])('rejects invalid intake hour %s', (hour) => {
    if (hour === 0) expect(validateAutomationConfiguration({ ...snapshot.automation, intake: { ...snapshot.automation.intake, due_hour: hour } }).intake.due_hour).toBe(0);
    else expect(() => validateAutomationConfiguration({ ...snapshot.automation, intake: { ...snapshot.automation.intake, due_hour: hour } })).toThrow();
  });
  it.each([[[45, 30, 15, 7, 0]], [[45, 0]]])('round-trips valid milestones %s', (milestones) => {
    expect(validateAutomationConfiguration({ ...snapshot.automation, renewal: { ...snapshot.automation.renewal, milestones } }).renewal.milestones).toEqual(milestones);
  });
  it.each([[[0, 30]], [[30, 30, 0]], [[500, 0]], [[30]], [[]]])('rejects invalid milestones %s', (milestones) => {
    expect(() => validateAutomationConfiguration({ ...snapshot.automation, renewal: { ...snapshot.automation.renewal, milestones } })).toThrow();
  });
});
