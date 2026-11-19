import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/leads/[id]/enrich/route';
import { getSupabaseServerClient } from './supabase-server';
import { fmcsaGetCarrier } from './enrichment';
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: 'actor' }, error: null }) }));
vi.mock('./enrichment', () => ({
  fmcsaConfigured: () => true, fmcsaGetCarrier: vi.fn(),
  fmcsaSearchByName: vi.fn(), oshaConfigured: () => false, oshaInspectionsByName: vi.fn(),
  stateFromAddress: () => 'AZ',
}));
let calls: Array<Record<string, unknown>>;
let conflict = false;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; conflict = false;
  vi.mocked(fmcsaGetCarrier).mockResolvedValue({
    dot_number: '123', legal_name: 'Synthetic', dba_name: null, entity_type: null,
    operating_status: null, safety_rating: null, safety_rating_date: null, power_units: 12,
    drivers: null, mcs150_date: null, physical_address: null, inspections_total: null,
    driver_oos_rate: null, driver_oos_national_avg: null, vehicle_oos_rate: null,
    vehicle_oos_national_avg: null, crashes_total: null, crashes_fatal: null,
    crashes_injury: null, crashes_tow: null, fetched_at: '2026-11-05T09:00:00Z',
  });
  const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
    fetch: async (url, init) => {
      const rpc = String(url).includes('/record_intelligence_enrichment');
      if (rpc) calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(rpc ? conflict ? { code: 'PT409', message: 'Lead identity changed during lookup. Refresh before saving evidence.' } : true
        : { full_name: 'Synthetic', address: 'Test, AZ', form_payload: { preserve: true } }), {
        status: rpc && conflict ? 409 : 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
const post = () => POST(new NextRequest('http://localhost/api/leads/lead/enrich', { method: 'POST', body: '{"dot_number":"123"}' }),
  { params: Promise.resolve({ id: 'lead' }) });
describe('enrichment observation persistence', () => {
  it('stores history and merges only source enrichment through the atomic RPC', async () => {
    expect((await post()).status).toBe(200);
    expect(calls).toEqual([expect.objectContaining({ p_actor: 'actor', p_source: 'fmcsa',
      p_match_method: 'agent_selected_dot', p_expected: { full_name: 'Synthetic', address: 'Test, AZ' },
      p_record: expect.objectContaining({ power_units: 12, match_method: 'agent_selected_dot' }) })]);
  });
  it('surfaces identity conflict rather than overwriting an edited lead', async () => {
    conflict = true;
    expect((await post()).status).toBe(409);
  });
});
