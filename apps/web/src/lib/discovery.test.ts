import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { discoveryFilters } from './discovery';
import { getSupabaseServerClient } from './supabase-server';
import { POST as acquire } from '../app/api/intelligence/acquire/route';
import { GET as candidates, PATCH as review } from '../app/api/intelligence/candidates/route';
import { POST as saveSource } from '../app/api/intelligence/sources/route';
import { GET as searches, POST as saveSearch, DELETE as deleteSearch } from '../app/api/intelligence/searches/route';
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: 'actor' }, error: null }) }));
const sourceId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const batchId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
let role: string;
let active: boolean;
let sourceActive: boolean;
let conflict: boolean;
let calls: Array<{ path: string; url: URL; body: Record<string, unknown> }>;
beforeEach(() => {
  vi.clearAllMocks(); role = 'owner'; active = true; sourceActive = true; conflict = false; calls = [];
  const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.split('/').pop() ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path, url, body });
      let data: unknown;
      let status = 200;
      switch (path) {
        case 'agency_members': data = { role, active, user_id: 'actor' }; break;
        case 'discovery_sources': data = { active: sourceActive, acquisition_until: '2099-12-31' }; break;
        case 'intelligence_import_matches': data = (body.p_candidates as Array<{ index: number }>).map((candidate) => ({ index: candidate.index, matches: [] })); break;
        case 'acquire_discovery_file': data = { batch_id: batchId, already_acquired: false, prospect_count: 1 }; break;
        case 'search_discovery_candidates': data = { candidates: [], total: 0 }; break;
        case 'review_discovery_candidate': data = conflict ? { code: 'PT409', message: 'Candidate changed or was promoted. Refresh before reviewing.' } : { id: sourceId }; status = conflict ? 409 : 200; break;
        case 'save_discovery_source': data = { id: sourceId }; break;
        case 'discovery_saved_searches': data = init?.method === 'POST' ? { id: sourceId, name: 'Saved niche', filters: {} } : [{ id: sourceId }]; break;
        default: throw new Error(`Unexpected discovery request: ${path}`);
      }
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
const jsonRequest = (path: string, body: unknown, method = 'POST') =>
  new NextRequest(`http://localhost/api/intelligence/${path}`, { method, body: JSON.stringify(body) });
const fileRequest = (source = sourceId) => {
  const form = new FormData();
  form.set('source_id', source); form.set('request_id', batchId);
  form.set('file', new File(['Company,Email\nSynthetic,test@example.invalid'], 'synthetic.csv'));
  return new NextRequest('http://localhost/api/intelligence/acquire', { method: 'POST', body: form });
};
describe('discovery targeting contracts', () => {
  it('normalizes state and retains zero-size limits', () => {
    expect(discoveryFilters({ state: 'az', employees_min: 0, renewal_from: '2027-02' })).toMatchObject({ state: 'AZ', employees_min: 0, renewal_from: '2027-02' });
  });
  it.each([{ employees_min: -1 }, { employees_min: 5, employees_max: 4 }, { state: 'AZ|CA' },
    { review: 'invented' }, { renewal_from: '2027-13' }, { renewal_from: '2027-05', renewal_to: '2027-04' }])('rejects invalid filters %j', (filters) => {
    expect(() => discoveryFilters(filters)).toThrow();
  });
  it('passes validated targeting and pagination to the database search', async () => {
    expect((await candidates(new NextRequest('http://localhost/api/intelligence/candidates?state=az&page=2&employees_min=0'))).status).toBe(200);
    expect(calls.find((call) => call.path === 'search_discovery_candidates')?.body).toMatchObject({ p_actor: 'actor', p_page: 2, p_filters: { state: 'AZ', employees_min: 0 } });
  });
});
describe('approved-file acquisition', () => {
  it('uses one retry-safe atomic staging operation after full-book matching', async () => {
    expect((await acquire(fileRequest())).status).toBe(201);
    const saved = calls.find((call) => call.path === 'acquire_discovery_file')?.body;
    expect(saved).toMatchObject({ p_actor: 'actor', p_source: sourceId, p_request: batchId, p_prospects: [
      expect.objectContaining({ full_name: 'Synthetic', disposition: 'pending' }),
    ] });
    expect(saved?.p_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.some((call) => /outbox|enroll|send/.test(call.path))).toBe(false);
  });
  it('blocks unapproved sources before parsing or matching', async () => {
    sourceActive = false;
    expect((await acquire(fileRequest())).status).toBe(403);
    expect(calls.some((call) => call.path === 'intelligence_import_matches')).toBe(false);
  });
  it('requires active membership even while the multi-agent flag is off', async () => {
    active = false;
    expect((await acquire(fileRequest())).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
  it('retains reviewer identity and stale-review conflict status', async () => {
    conflict = true;
    expect((await review(jsonRequest('candidates', { id: sourceId, expected_updated_at: '2026-11-05T09:00:00Z', review: 'reviewed', note: 'Confirmed role' }, 'PATCH'))).status).toBe(409);
    expect(calls.find((call) => call.path === 'review_discovery_candidate')?.body.p_actor).toBe('actor');
  });
});
describe('owner approvals and personal saved searches', () => {
  it('does not let admins approve sources', async () => {
    role = 'admin';
    expect((await saveSource(jsonRequest('sources', { config: {} }))).status).toBe(403);
    expect(calls.some((call) => call.path === 'save_discovery_source')).toBe(false);
  });
  it('rejects impossible acquisition dates without a database write', async () => {
    expect((await saveSource(jsonRequest('sources', { config: { name: 'Source', permission_reference: 'Contract', retained_crm_rights: true, acquisition_until: '2027-02-30' } }))).status).toBe(400);
  });
  it('queries and deletes saved targeting only in the actor scope', async () => {
    expect((await searches(new NextRequest('http://localhost/api/intelligence/searches'))).status).toBe(200);
    expect((await deleteSearch(jsonRequest('searches', { id: sourceId }, 'DELETE'))).status).toBe(200);
    expect(calls.filter((call) => call.path === 'discovery_saved_searches').every((call) => call.url.searchParams.get('user_id') === 'eq.actor')).toBe(true);
  });
  it('stores validated targeting with the authenticated user rather than a supplied actor', async () => {
    expect((await saveSearch(jsonRequest('searches', { name: 'Saved niche', user_id: 'other', filters: { state: 'AZ' } }))).status).toBe(201);
    expect(calls.find((call) => call.path === 'discovery_saved_searches')?.body).toMatchObject({ user_id: 'actor', filters: { state: 'AZ' } });
  });
});
