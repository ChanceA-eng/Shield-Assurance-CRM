import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/clients/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), requireApiSession: vi.fn(), apiActorName: () => 'QA agent' }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const id = '10000000-0000-4000-8000-000000000001';
let calls: Array<{ table: string; method: string; body: unknown }>;
let failAssets: boolean;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; failAssets = false;
  const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const table = new URL(String(input)).pathname.split('/').pop()!;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ table, method, body });
      if (table === 'clients' && method === 'POST') return Response.json({ id, ...body[0] });
      if (table === 'client_assets' && failAssets) return Response.json({ code: 'XX000', message: 'Asset unavailable' }, { status: 500 });
      return new Response(null, { status: 204 });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user: { id }, error: null } as Awaited<ReturnType<typeof getApiSession>>);
});
const submit = (intake_details: unknown) => POST(new NextRequest('http://localhost/api/clients', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ full_name: 'Synthetic account', source: 'Manual', intake_details }),
}));
describe('optional account intake persistence', () => {
  const details = { applicant: { years_at_address: '1' }, drivers: [{ name: 'Synthetic driver', license_state: 'AZ', license_number: 'QA1234' }] };
  it('stores validated optional details and driver inventory without assuming consent or issuing coverage', async () => {
    const response = await submit(details);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ intake_details: { applicant: { years_at_address: '1' }, drivers: [expect.objectContaining({ license_number: 'QA1234' })] },
      email_consent: false, sms_consent: false });
    expect(calls.find((call) => call.table === 'client_assets')?.body).toMatchObject([{ client_id: id, lead_id: null,
      metadata: { details: { license_number: 'QA1234' }, source: 'client_reported' } }]);
    expect(calls.map((call) => call.table)).toEqual(['clients', 'client_assets']);
  });
  it('rejects invalid new data before creating an account', async () => {
    expect((await submit({ applicant: { requested_effective: '2027-02-30' } })).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('removes its newly created account if driver inventory cannot be saved', async () => {
    failAssets = true;
    expect((await submit(details)).status).toBe(500);
    expect(calls.at(-1)).toMatchObject({ table: 'clients', method: 'DELETE' });
  });
});
