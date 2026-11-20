import { beforeEach, it, expect, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import type { CarrierAppetiteValues } from '@crm/shared';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { activeAgencyMember } from './agency-membership';
import { interpretCarrierGuide } from './carrier-appetite-ai';
import { GET, POST } from '../app/api/carrier-appetite/route';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn() }));
vi.mock('./carrier-appetite-ai', () => ({ interpretCarrierGuide: vi.fn() }));
const id = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const user: User = { id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-11T00:00:00Z' };
const values: CarrierAppetiteValues = { carrier: 'Synthetic Carrier', title: 'Guide', line: 'GL', states: 'AZ', effective_on: '2026-01-01', expires_on: '',
  access: 'unconfirmed', access_reference: '', rights_reference: 'Authorized fixture',
  rules: [{ id: actor, criterion: 'Restaurants', decision: 'eligible', page: 1, excerpt: 'Restaurants' }] };
const document = { id, revision: 1, state: 'draft', values, pages: [{ page: 1, text: 'Restaurants' }],
  file_name: 'guide.txt', storage_path: `carrier-appetite/${id}/guide.txt`, file_size: 11, content_type: 'text/plain' };
const calls: Array<{ url: URL; method: string; body: Record<string, unknown> }> = [];
let missing = false;
let stored = true;
let concurrent = false;
let teamAccess: { mode: 'restricted'; grants: Record<string, unknown> };
const request = (body: object): NextRequest => new NextRequest('http://localhost/api/carrier-appetite', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; missing = false; stored = true; concurrent = false;
  teamAccess = { mode: 'restricted', grants: { 'knowledge.view': 'agency', 'knowledge.edit': 'agency' } };
  vi.mocked(interpretCarrierGuide).mockResolvedValue({ ...values,
    interpretation: { source_hash: 'a'.repeat(64), version: 'guide-ai-v1', summary: 'Synthetic cited reading.' } });
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess });
  vi.mocked(activeAgencyMember).mockResolvedValue({ user_id: actor, email: 'synthetic@example.test', role: 'owner', active: true, sender_profile: null, gmail_ai_opt_in: false });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (missing) return Response.json({ code: 'PGRST205', message: 'Missing table' }, { status: 404 });
    if (url.pathname.endsWith('/carrier_appetite_source_overlaps')) return Response.json([]);
    if (url.pathname.endsWith('/apply_carrier_appetite_reading')) return Response.json({ ...document, values: body.p_values, revision: 3 });
    if (url.pathname.endsWith('/save_carrier_appetite')) {
      if (concurrent) return Response.json({ code: 'PT409', message: 'Document changed. Reload before saving or reviewing.' }, { status: 409 });
      return Response.json({ ...document, revision: 2, state: body.p_action === 'activate' ? 'active' : 'draft' });
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) return Response.json(stored ? [{ name: 'guide.txt', metadata: { size: 11, mimetype: 'text/plain' } }] : []);
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/')) return Response.json({ url: '/object/upload/sign/account-documents/carrier-appetite/guide.txt?token=synthetic' });
    if (url.pathname.startsWith('/storage/v1/object/account-documents/')) return new Response('Restaurants', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname.endsWith('/carrier_appetite_documents')) return Response.json(url.searchParams.has('id') ? document : [document]);
    throw new Error(`Unexpected external request: ${url.pathname}`);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'synthetic-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
it('denies unauthenticated access before reading storage or documents', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
  expect((await GET(new NextRequest('http://localhost/api/carrier-appetite'))).status).toBe(401);
  expect(calls).toEqual([]);
});
it('allows agents to read only active guidance and denies all appetite writes', async () => {
  teamAccess.grants = { 'knowledge.view': 'agency' };
  vi.mocked(activeAgencyMember).mockResolvedValue({ user_id: actor, email: 'synthetic@example.test', role: 'agent', active: true, sender_profile: null, gmail_ai_opt_in: false });
  const response = await GET(new NextRequest('http://localhost/api/carrier-appetite'));
  expect(response.status).toBe(200);
  expect(calls.find((item) => item.url.pathname.endsWith('/carrier_appetite_documents'))?.url.searchParams.get('state')).toBe('eq.active');
  calls.length = 0;
  expect((await POST(request({ id, revision: 1, action: 'activate', review_confirmed: true }))).status).toBe(403);
  expect(calls).toEqual([]);
});
it('persists reviewed evidence only after verifying private bytes; never calls Rashi or an AI service', async () => {
  const response = await POST(request({ id, revision: 1, action: 'save', pages: document.pages, values }));
  expect(response.status).toBe(200);
  const saved = calls.find((item) => item.url.pathname.endsWith('/save_carrier_appetite'));
  expect(saved?.body).toMatchObject({ p_actor: actor, p_id: id, p_expected: 1, p_input: { values, pages: document.pages } });
  expect(calls.every((item) => item.url.origin === 'https://example.supabase.co')).toBe(true);
  expect(calls.some((item) => /rashi|KnowledgeDocument|lead/i.test(item.url.pathname))).toBe(false);
  stored = false; calls.length = 0;
  expect((await POST(request({ id, revision: 1, action: 'save', pages: document.pages, values }))).status).toBe(409);
  expect(calls.some((item) => item.url.pathname.endsWith('/save_carrier_appetite'))).toBe(false);
});
it('enables a saved guide without a questionnaire and quarantines uncited entries without blocking save', async () => {
  expect((await POST(request({ id, revision: 1, action: 'activate' }))).status).toBe(200);
  concurrent = true;
  expect((await POST(request({ id, revision: 1, action: 'activate', review_confirmed: true }))).status).toBe(409);
  concurrent = false;
  expect((await POST(request({ id, revision: 1, action: 'save', pages: document.pages,
    values: { ...values, rules: [{ ...values.rules[0], excerpt: 'Unmatched extraction' }] } }))).status).toBe(200);
  const saved = calls.filter((item) => item.url.pathname.endsWith('/save_carrier_appetite')).at(-1);
  expect(saved?.body).toMatchObject({ p_input: { values: { rules: [], unresolved_entries: [{ criterion: 'Restaurants' }] } } });
});
it('recovers completed source uploads without duplicate bytes or public URLs', async () => {
  const response = await POST(request({ id, revision: 0, action: 'reserve', file_name: 'guide.txt', file_size: 11, content_type: 'text/plain' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ already_uploaded: true });
  expect(calls.some((item) => item.url.pathname.includes('/upload/sign/'))).toBe(false);
});
it('interprets the private stored source with immutable pages, then atomically applies an existing-guide reading', async () => {
  const response = await POST(request({ id, revision: 1, action: 'interpret_saved', pages: [{ page: 1, text: 'Injected replacement' }] }));
  expect(response.status).toBe(200);
  expect(interpretCarrierGuide).toHaveBeenCalledWith(expect.anything(), new Uint8Array(Buffer.from('Restaurants')), 'text/plain', document.pages, false);
  expect(calls.find((call) => call.url.pathname.endsWith('/apply_carrier_appetite_reading'))?.body).toMatchObject({
    p_actor: actor, p_id: id, p_expected: 1, p_values: { title: values.title, carrier: values.carrier, interpretation: { version: 'guide-ai-v1' } },
  });
  vi.mocked(interpretCarrierGuide).mockClear(); calls.length = 0;
  expect((await POST(request({ id, revision: 0, action: 'interpret' }))).status).toBe(409);
  expect(interpretCarrierGuide).not.toHaveBeenCalled();
  expect(calls.some((call) => call.url.pathname.startsWith('/storage/'))).toBe(false);
});
it('reports installation prerequisites rather than a success-shaped empty library', async () => {
  missing = true;
  const response = await GET(new NextRequest('http://localhost/api/carrier-appetite'));
  expect(response.status).toBe(503);
  expect((await response.json()).message).toContain('20261111010000_carrier_appetite');
});
