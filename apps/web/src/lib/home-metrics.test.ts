import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../app/api/metrics/home/route';
import { loadHomePremiumMetrics } from './home-metrics';
import { getSupabaseServerClient } from './supabase-server';
import { requireApiSession } from './api-auth';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ requireApiSession: vi.fn() }));

let summary: unknown;
let calls: Array<{ url: URL; body: Record<string, unknown> | null }>;
let failure: boolean;
let client: SupabaseClient;
const now = new Date('2026-11-02T21:00:00Z');
const request = (): NextRequest => new NextRequest('http://localhost/api/metrics/home');
function months(start: string, premium = 0): Array<{ month: string; premium: number }> {
  const date = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + i, 1)).toISOString().slice(0, 7), premium }));
}
beforeEach(() => {
  vi.clearAllMocks();
  summary = { total: 0, months: months('2025-12-01') };
  calls = []; failure = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null });
    if (url.pathname.endsWith('/home_premium_summary')) {
      return failure ? Response.json({ message: 'Premium aggregation failed', code: 'XX000' }, { status: 500 }) : Response.json(summary);
    }
    const count = url.pathname.endsWith('/renewals') ? 7 : url.pathname.endsWith('/claims') ? 2
      : url.searchParams.get('status') === 'eq.won' ? 3 : url.searchParams.has('status') ? 4 : 10;
    return new Response(null, { headers: { 'Content-Range': `0-0/${count}` } });
  };
  client = createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(client);
  vi.mocked(requireApiSession).mockResolvedValue(null);
});

describe('complete home premium metrics', () => {
  it('uses one database aggregate instead of downloading every policy', async () => {
    const series = months('2025-12-01'); series[11]!.premium = 150475.25;
    summary = { total: '150475.25', months: series };
    const result = await loadHomePremiumMetrics(client, now);
    expect(result.total_written_premium).toBe(150475);
    expect(result.written_premium_series).toHaveLength(12);
    expect(result.written_premium_series[11]).toEqual({ month: 'Nov', premium: 150475 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toContain('/rpc/home_premium_summary');
    expect(calls[0]!.body).toEqual({ p_first_month: '2025-12-01' });
  });
  it('uses Arizona month boundaries while preserving the all-time total', async () => {
    const series = months('2025-11-01'); series[0]!.premium = 10.5; series[11]!.premium = 20.5;
    summary = { total: 101, months: series };
    const result = await loadHomePremiumMetrics(client, new Date('2026-11-01T03:00:00Z'));
    expect(calls[0]!.body).toEqual({ p_first_month: '2025-11-01' });
    expect(result.total_written_premium).toBe(101);
    expect(result.written_premium_series[0]).toEqual({ month: 'Nov', premium: 11 });
    expect(result.written_premium_series[11]).toEqual({ month: 'Oct', premium: 21 });
  });
  it('returns a complete zero series for an empty database', async () => {
    const result = await loadHomePremiumMetrics(client, now);
    expect(result.total_written_premium).toBe(0);
    expect(result.written_premium_series).toHaveLength(12);
    expect(result.written_premium_series.every((item) => item.premium === 0)).toBe(true);
  });
  it('surfaces database errors instead of showing zero premium', async () => {
    failure = true;
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ details: 'Something went wrong. Please try again, and contact your administrator if it keeps happening.' });
  });
  it.each([null, {}, { total: 'invalid', months: months('2025-12-01') },
    { total: 0, months: [] }, { total: 0, months: months('2025-11-01') }])('rejects malformed or partial summaries %#', async (value) => {
    summary = value;
    await expect(loadHomePremiumMetrics(client, now)).rejects.toThrow('invalid');
  });
  it('requires authentication before reading any premium data', async () => {
    vi.mocked(requireApiSession).mockResolvedValue(NextResponse.json({ message: 'Unauthorized' }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('preserves canonical renewal windows and existing aliases', async () => {
    summary = { total: 100, months: months('2025-12-01') };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_written_premium: 100, totalPremium: 100, premium: 100,
      renewals_30_days: 7, active_leads: 4, lead_conversion_rate: 0.3, open_claims: 2,
    });
    expect(calls.find(({ url }) => url.pathname.endsWith('/renewals'))?.url.searchParams.get('renewal_bucket')).toBe('eq.0-30');
  });
});
