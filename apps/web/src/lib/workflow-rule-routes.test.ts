import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import type { CrmWorkflowDefinition } from '@crm/shared';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET, POST } from '../app/api/settings/automation/rules/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const id = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88a';
const user: User = { id, aud: 'authenticated', created_at: '2026-11-05T00:00:00Z', app_metadata: {}, user_metadata: {} };
const definition: CrmWorkflowDefinition = { schema_version: 1, name: 'QA rule', event: 'lead.created', active: true,
  conditions: { sources: [], stages: [], statuses: [], lines: [], assignee: null },
  action: { type: 'notify', content: 'Review {{name}}', delay_minutes: 0, priority: 'medium', assignee: null } };
const row = { id, revision: 2, definition, updated_at: '2026-11-05T00:00:00Z' };
let role: string;
let saved: unknown;
let calls: Array<{ url: URL; method: string; body: unknown }>;
beforeEach(() => {
  vi.clearAllMocks(); role = 'owner'; saved = row; calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      let data: unknown = [];
      if (url.pathname.endsWith('/agency_members')) data = url.searchParams.has('user_id')
        ? { user_id: id, role, active: true } : [{ user_id: id, email: 'qa@example.invalid', role }];
      if (url.pathname.endsWith('/workflow_rules')) data = url.searchParams.has('id') ? row : [row];
      if (url.pathname.endsWith('/workflow_rule_versions')) data = [{ revision: 2, definition, recorded_at: row.updated_at }];
      if (url.pathname.endsWith('/save_workflow_rule')) data = saved;
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } });
    } },
  }));
});
afterEach(() => vi.restoreAllMocks());
const post = (body: unknown): NextRequest => new NextRequest('http://localhost/api/settings/automation/rules', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
describe('private owner workflow configuration API', () => {
  it.each(['agent', 'admin'])('blocks %s without exposing rules or calling mutation RPCs', async (value) => {
    role = value;
    expect((await GET(new NextRequest('http://localhost/api/settings/automation/rules'))).status).toBe(403);
    expect((await POST(post({ rule_id: null, expected_revision: 0, definition }))).status).toBe(403);
    expect(calls.every((call) => call.url.pathname.endsWith('/agency_members'))).toBe(true);
  });
  it.each(['page=-1', 'page=nan', 'rule=bad', 'event=deal.bound', 'active=maybe'])('rejects invalid filter %s', async (query) => {
    expect((await GET(new NextRequest(`http://localhost/api/settings/automation/rules?${query}`))).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it('returns paginated rules, actual member choices and selected history privately without executing work', async () => {
    const result = await GET(new NextRequest(`http://localhost/api/settings/automation/rules?page=1&rule=${id}&q=QA&event=lead.created&active=true`));
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(await result.json()).toMatchObject({ items: [row], selected_rule: row, page: 1, page_size: 25,
      members: [{ user_id: id, role: 'owner' }], history: [{ revision: 2 }], coexistence: 'built-in-priority' });
    const list = calls.find((call) => call.url.pathname.endsWith('/workflow_rules'));
    expect(list?.url.searchParams.get('offset')).toBe('25'); expect(list?.url.searchParams.get('limit')).toBe('25');
    expect(list?.url.searchParams.get('trigger_type')).toBe('eq.lead.created');
    expect(list?.url.searchParams.get('active')).toBe('eq.true');
    expect(calls.some((call) => call.url.pathname.includes('/rpc/'))).toBe(false);
  });
  it('saves the exact validated revision without changing tasks, notifications, enrollment or invoking AI', async () => {
    const result = await POST(post({ rule_id: id, expected_revision: 1, definition }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual(row);
    expect(calls.map((call) => call.url.pathname)).toEqual(['/rest/v1/agency_members', '/rest/v1/rpc/save_workflow_rule']);
    expect(calls[1].body).toEqual({ p_actor: id, p_rule: id, p_expected_revision: 1, p_definition: definition });
  });
  it.each([
    { rule_id: id, expected_revision: -1, definition },
    { rule_id: 'invented', expected_revision: 1, definition },
    { rule_id: id, expected_revision: 1, definition, send: true },
    { rule_id: id, expected_revision: 1, definition: { ...definition, action: { ...definition.action, type: 'send_email' } } },
  ])('rejects unsafe save payload %# before calling the RPC', async (body) => {
    expect((await POST(post(body))).status).toBe(400); expect(calls).toHaveLength(1);
  });
  it('rejects malformed success-shaped saved rows', async () => {
    saved = { ok: true };
    expect((await POST(post({ rule_id: null, expected_revision: 0, definition }))).status).toBe(500);
  });
});
