import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GET } from '../app/api/metrics/home/route';
import { loadHomePremiumMetrics } from './home-metrics';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

interface Policy { premium: number | string | null; effective_date: string | null }
let policies: Policy[];
let calls: URL[];
let cap: number;
let failOffset: number | null;
let client: SupabaseClient;
const now = new Date('2026-11-02T21:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  policies = [];
  calls = [];
  cap = 500;
  failOffset = null;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    if (url.pathname.endsWith('/policies')) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (offset === failOffset) return new Response(JSON.stringify({ message: 'Premium page failed', code: 'XX000' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
      return new Response(JSON.stringify(policies.slice(offset, offset + Math.min(cap, Number(url.searchParams.get('limit') ?? cap)))), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const count = url.pathname.endsWith('/renewals') ? 7 : url.pathname.endsWith('/claims') ? 2
      : url.searchParams.get('status') === 'eq.won' ? 3 : url.searchParams.has('status') ? 4 : 10;
    return new Response(null, { headers: { 'Content-Range': `0-0/${count}` } });
  };
  client = createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(client);
});

describe('complete home premium metrics', () => {
  it('includes more than 1000 policies in the total and chart rather than capped list data', async () => {
    policies = Array.from({ length: 1501 }, () => ({ premium: '100.25', effective_date: '2026-11-01' }));
    const result = await loadHomePremiumMetrics(client, now);
    expect(result.total_written_premium).toBe(150475);
    expect(result.written_premium_series).toHaveLength(12);
    expect(result.written_premium_series[11]).toEqual({ month: 'Nov', premium: 150475 });
    expect(calls.map((url) => Number(url.searchParams.get('offset')))).toEqual([0, 500, 1000, 1500, 1501]);
    expect(calls.every((url) => url.searchParams.get('order') === 'id.asc')).toBe(true);
  });
  it('continues when the server applies a smaller page cap', async () => {
    cap = 50;
    policies = Array.from({ length: 121 }, () => ({ premium: 10, effective_date: '2026-11-01' }));
    expect((await loadHomePremiumMetrics(client, now)).total_written_premium).toBe(1210);
    expect(calls.map((url) => Number(url.searchParams.get('offset')))).toEqual([0, 50, 100, 121]);
  });
  it('uses the Arizona month at a UTC month boundary and keeps out-of-period policies in the all-time total only', async () => {
    policies = [
      { premium: 10.5, effective_date: '2025-11-01' },
      { premium: '20.5', effective_date: '2026-10-31' },
      { premium: 30, effective_date: '2025-10-31' },
      { premium: 40, effective_date: '2026-11-01' },
      { premium: null, effective_date: null },
    ];
    const result = await loadHomePremiumMetrics(client, new Date('2026-11-01T03:00:00Z'));
    expect(result.total_written_premium).toBe(101);
    expect(result.written_premium_series[0]).toEqual({ month: 'Nov', premium: 11 });
    expect(result.written_premium_series[11]).toEqual({ month: 'Oct', premium: 21 });
    expect(result.written_premium_series.slice(1, 11).every((item) => item.premium === 0)).toBe(true);
  });
  it('returns an empty 12-month series with zero values when no policies exist', async () => {
    const result = await loadHomePremiumMetrics(client, now);
    expect(result.total_written_premium).toBe(0);
    expect(result.written_premium_series).toHaveLength(12);
    expect(result.written_premium_series.every((item) => item.premium === 0)).toBe(true);
  });
  it('fails explicitly instead of returning a partial total when a later page fails', async () => {
    policies = Array.from({ length: 501 }, () => ({ premium: 100, effective_date: '2026-11-01' }));
    failOffset = 500;
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ details: expect.stringContaining('Premium page failed') });
  });
  it('rejects invalid premium data instead of silently reporting it as zero', async () => {
    policies = [{ premium: 'invalid', effective_date: '2026-11-01' }];
    await expect(loadHomePremiumMetrics(client, now)).rejects.toThrow('invalid premium');
  });
  it('uses the canonical renewal bucket and preserves existing metric aliases', async () => {
    policies = [{ premium: 100, effective_date: '2026-11-01' }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_written_premium: 100, totalPremium: 100, premium: 100,
      renewals_30_days: 7, active_leads: 4, lead_conversion_rate: 0.3, open_claims: 2,
    });
    expect(calls.find((url) => url.pathname.endsWith('/renewals'))?.searchParams.get('renewal_bucket')).toBe('eq.0-30');
  });
});
