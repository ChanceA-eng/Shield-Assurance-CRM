import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { sendOutboundEmail } from './email-adapter';
import { GET } from '../app/api/outreach/route';
import { PATCH } from '../app/api/outreach/outbox/[id]/route';
import { activityFilters, DeliveryState } from '../app/outreach/DeliveryState';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ requireApiSession: vi.fn().mockResolvedValue(null) }));
vi.mock('./email-adapter', () => ({ sendOutboundEmail: vi.fn() }));
const id = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
interface Call { url: URL; method: string; body: Record<string, unknown> | null }
let calls: Call[];
let respond: (call: Call) => Response;
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  respond = (call) => {
    if (call.url.pathname.endsWith('/outreach_settings')) return json({ daily_send_cap: 20 });
    if (call.url.pathname.endsWith('/finalize_outreach_send')) return json(true);
    if (call.url.pathname.endsWith('/outreach_outbox') && call.method !== 'HEAD') return json([]);
    return call.method === 'HEAD' ? new Response(null, { headers: { 'Content-Range': '0-0/0' } }) : json([]);
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call);
    return respond(call);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});

describe('outreach reconciliation presentation', () => {
  it.each(['sending', 'acceptance_unknown', 'failed'])('offers no resend or mutation action for %s', (status) => {
    const html = renderToStaticMarkup(createElement(DeliveryState, { status, busy: false, onFinish: vi.fn() }));
    expect(html).toContain('Do not resend.');
    expect(html).toContain('Gmail/SendGrid logs');
    expect(html).not.toContain('<button');
  });
  it('only offers recording recovery when acceptance is already persisted', () => {
    const html = renderToStaticMarkup(createElement(DeliveryState, { status: 'accepted_by_provider', busy: false, onFinish: vi.fn() }));
    expect(html).toContain('Finish recording — no resend');
    expect(html).toContain('recipient delivery is not confirmed');
    expect(html).not.toContain('Approve');
    const complete = renderToStaticMarkup(createElement(DeliveryState, { status: 'sent', busy: false, onFinish: vi.fn() }));
    expect(complete).toContain('Accepted — recording complete');
    expect(complete).not.toContain('<button');
  });
  it('exposes dedicated filters for stalled and uncertain attempts', () => {
    expect(activityFilters.map(([value]) => value)).toEqual([
      'all', 'sending', 'acceptance_unknown', 'accepted_by_provider', 'sent', 'failed',
    ]);
  });
});

describe('outreach reconciliation API', () => {
  it.each(['sending', 'acceptance_unknown', 'accepted_by_provider'])('loads %s independently of newer completed attempts', async (status) => {
    expect((await GET(new NextRequest(`http://localhost/api/outreach?recent_status=${status}`))).status).toBe(200);
    const recent = calls.find((call) => call.url.searchParams.get('select')?.includes('step_number'));
    expect(recent?.url.searchParams.get('status')).toBe(`in.(${status})`);
  });
  it('includes all delivery states by default and rejects unknown filters', async () => {
    expect((await GET(new NextRequest('http://localhost/api/outreach'))).status).toBe(200);
    const recent = calls.find((call) => call.url.searchParams.get('select')?.includes('step_number'));
    expect(recent?.url.searchParams.get('status')).toBe('in.(sent,failed,sending,acceptance_unknown,accepted_by_provider)');
    calls = [];
    expect((await GET(new NextRequest('http://localhost/api/outreach?recent_status=delivered'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('surfaces activity query errors rather than an empty success state', async () => {
    respond = () => json({ message: 'schema unavailable', code: 'XX000' }, 500);
    const response = await GET(new NextRequest('http://localhost/api/outreach'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('schema unavailable') });
  });
  it('loads the exact selected attempt even when it falls outside the recent activity page', async () => {
    const original = respond;
    respond = (call) => call.url.pathname.endsWith('/outreach_outbox') && call.url.searchParams.get('id') === `eq.${id}`
      ? json({ id, lead_id: id, status: 'acceptance_unknown', subject: 'Exact selected attempt' }) : original(call);
    const response = await GET(new NextRequest(`http://localhost/api/outreach?attempt=${id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).recent).toContainEqual(expect.objectContaining({ id, subject: 'Exact selected attempt' }));
  });
  it('reports an invalid or missing selected attempt explicitly', async () => {
    expect((await GET(new NextRequest('http://localhost/api/outreach?attempt=invalid'))).status).toBe(400);
    const original = respond;
    respond = (call) => call.url.searchParams.get('id') === `eq.${id}` ? json(null) : original(call);
    expect((await GET(new NextRequest(`http://localhost/api/outreach?attempt=${id}`))).status).toBe(404);
  });
  it('finishes recording through only the transactional RPC, never a provider', async () => {
    const response = await PATCH(new NextRequest(`http://localhost/api/outreach/outbox/${id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'finish_recording' }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery_status: 'accepted_by_provider' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/finalize_outreach_send');
    expect(calls[0].body?.p_outbox_id).toBe(id);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
  it('does not convert rejected recovery for uncertain acceptance into a send', async () => {
    respond = () => json({ message: 'Provider acceptance is not recorded; do not resend', code: 'P0001' }, 400);
    const response = await PATCH(new NextRequest(`http://localhost/api/outreach/outbox/${id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'finish_recording' }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('do not resend') });
    expect(calls).toHaveLength(1);
    expect(sendOutboundEmail).not.toHaveBeenCalled();
  });
});
