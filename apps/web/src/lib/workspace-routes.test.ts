import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { getApiSession, requireApiSession } from './api-auth';
import { POST as addAsset, PATCH as changeAsset } from '../app/api/record-assets/route';
import { POST as addNote, PATCH as changeNote } from '../app/api/interactions/route';
import { GET as getTasks, PATCH as changeTask } from '../app/api/tasks/route';
import { GET as getLead } from '../app/api/leads/[id]/route';
import { GET as getBriefing } from '../app/api/briefing/route';
import { GET as getRecent } from '../app/api/recent/route';
import { GET as getAttention, PATCH as acknowledgeAttention } from '../app/api/leads/attention/route';
import { GET as getDirectory } from '../app/api/clients/directory/route';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), requireApiSession: vi.fn(), apiActorName: () => 'Test agent' }));

const leadId = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const itemId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const now = '2026-10-31T16:30:00.000Z';
const user: User = { id: itemId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: now };
const calls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
let respond: (url: URL, method: string, body: Record<string, unknown> | null) => Response;

function json(data: unknown, status = 200, count?: number): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', ...(count === undefined ? {} : { 'Content-Range': `0-0/${count}` }),
  } });
}

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

beforeEach(() => {
  calls.length = 0;
  respond = () => json({ message: 'Unexpected test database request' }, 500);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, method, body });
    return respond(url, method, body);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(requireApiSession).mockResolvedValue(null);
});

describe('Workspace route contracts', () => {
  it('requires authentication before directory access', async () => {
    vi.mocked(requireApiSession).mockResolvedValue(NextResponse.json({ message: 'Unauthorized' }, { status: 401 }));
    expect((await getDirectory(request('/api/clients/directory'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('rejects invalid directory filters and pages before querying', async () => {
    expect((await getDirectory(request('/api/clients/directory?filter=invalid'))).status).toBe(400);
    expect((await getDirectory(request('/api/clients/directory?page=-1'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('paginates beyond a full database batch and searches accounts past the first hundred', async () => {
    respond = (url) => {
      if (!url.pathname.endsWith('/clients')) return json([]);
      const offset = Number(url.searchParams.get('offset') ?? '0');
      return json(Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({
        id: `account-${offset + index}`, full_name: `Account ${offset + index}`, email: null, phone: null,
        address: null, account_type: null, assigned_producer: null, created_at: now,
      })));
    };
    const response = await getDirectory(request('/api/clients/directory?q=Account%20500'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, page: 0, page_size: 25, items: [{ id: 'account-500' }] });
    expect(calls.filter((call) => call.url.pathname.endsWith('/clients'))).toHaveLength(2);
  });

  it('requires authentication before any asset database access', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
    expect((await addAsset(request(`/api/record-assets?record_type=lead&record_id=${leadId}`, 'POST', {}))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('treats reordered JSONB keys as the same retried asset', async () => {
    respond = (url, method) => {
      if (url.pathname.endsWith('/leads')) return json({ id: leadId, full_name: 'Leo', account_id: null });
      if (method === 'POST') return json({ code: '23505', message: 'Existing save id' }, 409);
      return json({ id: itemId, title: 'Truck 1', asset_type: 'vehicle', metadata: { source: 'client_reported', details: { model: 'F-150', make: 'Ford' } } });
    };
    const response = await addAsset(request(`/api/record-assets?record_type=lead&record_id=${leadId}`, 'POST', {
      id: itemId, title: 'Truck 1', asset_type: 'vehicle', details: { make: 'Ford', model: 'F-150' }, source: 'client_reported',
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(itemId);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('does not accept a different asset as an idempotent retry', async () => {
    respond = (url, method) => {
      if (url.pathname.endsWith('/leads')) return json({ id: leadId, full_name: 'Leo', account_id: null });
      if (method === 'POST') return json({ code: '23505', message: 'Existing save id' }, 409);
      return json({ id: itemId, title: 'A different truck', asset_type: 'vehicle', metadata: { source: 'client_reported', details: {} } });
    };
    expect((await addAsset(request(`/api/record-assets?record_type=lead&record_id=${leadId}`, 'POST', {
      id: itemId, title: 'Truck 1', asset_type: 'vehicle', details: {}, source: 'client_reported',
    }))).status).toBe(409);
  });

  it('reports a stale asset edit instead of overwriting it', async () => {
    respond = (url, method) => {
      if (url.pathname.endsWith('/leads')) return json({ id: leadId, full_name: 'Leo', account_id: null });
      return json(method === 'PATCH' ? [] : { id: itemId, metadata: {} });
    };
    expect((await changeAsset(request(`/api/record-assets?record_type=lead&record_id=${leadId}`, 'PATCH', {
      id: itemId, action: 'archive', expected_updated_at: now,
    }))).status).toBe(409);
  });

  it('rejects an invalid reminder before attempting to save a note', async () => {
    respond = () => json({ id: leadId, full_name: 'Leo', account_id: null });
    const response = await addNote(request('/api/interactions', 'POST', {
      lead_id: leadId, content: 'Three trucks.', reminder: { subject: 'Request VINs', due_date: '2026-02-30T10:00:00Z' },
    }));
    expect(response.status).toBe(400);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('saves note and named reminder through one atomic RPC', async () => {
    respond = (url) => url.pathname.endsWith('/leads')
      ? json({ id: leadId, full_name: 'Leo', account_id: null })
      : json({ note: { id: itemId, content: 'Three trucks.' }, reminder: { id: itemId, kind: 'reminder' } });
    const response = await addNote(request('/api/interactions', 'POST', {
      id: itemId, lead_id: leadId, content: 'Three trucks.', note_type: 'call',
      reminder: { subject: 'Request VINs', due_date: '2026-10-31T09:30:00-07:00', priority: 'high' },
    }));
    expect(response.status).toBe(201);
    const rpc = calls.find((call) => call.url.pathname.endsWith('/rpc/save_note_with_reminder'));
    expect(rpc?.body?.p_reminder).toEqual({ subject: 'Leo: Request VINs', due_date: now, priority: 'high' });
    expect(rpc?.body?.p_client_id).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('requires a last-loaded timestamp for a note edit', async () => {
    expect((await changeNote(request('/api/interactions', 'PATCH', { id: itemId, content: 'New text' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('returns the exact task count, not the capped sample length', async () => {
    respond = () => json([], 200, 1234);
    const response = await getTasks(request('/api/tasks?status=open&count=true&limit=20'));
    expect(await response.json()).toEqual({ count: 1234 });
    expect(calls[0].method).toBe('HEAD');
  });

  it('keeps edited task actions attached to the real lead name', async () => {
    respond = (url, method, body) => {
      if (url.pathname.endsWith('/leads')) return json({ id: leadId, full_name: 'Leo', account_id: null });
      if (method === 'PATCH') return json({ id: itemId, ...body });
      return json({ id: itemId, related_type: 'lead', related_id: leadId, kind: 'reminder' });
    };
    const response = await changeTask(request('/api/tasks', 'PATCH', { id: itemId, subject: 'Request roof details' }));
    expect(response.status).toBe(200);
    expect((await response.json()).subject).toBe('Leo: Request roof details');
  });

  it('reads profile and acknowledgment IDs from one snapshot RPC', async () => {
    respond = () => json({ id: leadId, form_payload: { message: 'Current answers' }, intake_event_ids: [itemId] });
    const response = await getLead(request(`/api/leads/${leadId}`), { params: Promise.resolve({ id: leadId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).intake_event_ids).toEqual([itemId]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/lead_profile_snapshot');
  });

  it('rejects an invalid lead id without database access', async () => {
    expect((await getLead(request('/api/leads/not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('returns every unreviewed event across pages without an age cutoff', async () => {
    respond = (url) => {
      const length = url.searchParams.get('offset') === '100' ? 2 : 100;
      return json(Array.from({ length }, (_, index) => ({
        id: `${url.searchParams.get('offset') ?? '0'}-${index}`, lead_id: leadId,
        submitted_at: '2026-01-01T10:00:00Z', received_at: '2026-01-01T10:01:00Z', time_basis: 'submitted', snapshot: {},
        leads: { full_name: 'Leo', line_of_business: 'Commercial', account_id: null, industry: 'retail' },
      })));
    };
    const response = await getAttention(request('/api/leads/attention'));
    expect((await response.json()).leads).toHaveLength(102);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.url.searchParams.has('submitted_at'))).toBe(true);
  });
  it('acknowledges a deduplicated set of events atomically', async () => {
    respond = () => json(1);
    const response = await acknowledgeAttention(request('/api/leads/attention', 'PATCH', { ids: [itemId, itemId], action: 'opened' }));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/acknowledge_intake_events');
    expect(calls[0].body?.p_ids).toEqual([itemId]);
  });
});

describe('No-AI dashboard accuracy', () => {
  it('uses current due instants and exact briefing counts', async () => {
    respond = (url, method) => {
      if (url.pathname.endsWith('/tasks')) return json([{ id: itemId, subject: 'Leo: request VINs' }], 200, url.searchParams.getAll('due_date').length === 1 ? 9 : 12);
      return json([], 200, method === 'HEAD' ? 0 : undefined);
    };
    const response = await getBriefing(request('/api/briefing'));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.overdue_tasks).toBe(9);
    expect(result.today_tasks_count).toBe(12);
    expect(result.today_tasks).toHaveLength(1);
    expect(calls.every((call) => call.url.hostname === 'example.supabase.co')).toBe(true);
    const overdueQuery = calls.find((call) => call.url.pathname.endsWith('/tasks') && call.url.searchParams.getAll('due_date').length === 1);
    const dueInstant = overdueQuery?.url.searchParams.get('due_date')?.slice(3);
    expect(dueInstant && Math.abs(Date.now() - new Date(dueInstant).getTime())).toBeLessThan(10000);
  });

  it('surfaces a briefing database failure, not an all-clear summary', async () => {
    respond = (url) => url.pathname.endsWith('/tasks') ? json({ code: 'XX000', message: 'Task query unavailable' }, 500) : json([], 200, 0);
    const response = await getBriefing(request('/api/briefing'));
    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe('Task query unavailable');
  });

  it('timestamps completed work using the real audit event', async () => {
    respond = (url) => {
      if (url.pathname.endsWith('/client_activities')) return json([{ id: itemId, lead_id: leadId, client_id: null, activity_type: 'task_completed', title: 'Task completed: Request VIN', occurred_at: now }]);
      if (url.pathname.endsWith('/leads') && url.searchParams.has('id')) return json([{ id: leadId, full_name: 'Leo' }]);
      return json([]);
    };
    const response = await getRecent(request('/api/recent'));
    const result = await response.json();
    expect(result).toContainEqual(expect.objectContaining({ type: 'Task Done', touchedAt: now, href: `/leads?lead=${leadId}` }));
    expect(calls.some((call) => call.url.pathname.endsWith('/tasks'))).toBe(false);
  });
});
