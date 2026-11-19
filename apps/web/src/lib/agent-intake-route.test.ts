import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/leads/intake/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { scheduleIntakeTask } from './intake-task';
import { processLeadStatusChanged } from './automation';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: vi.fn(() => 'QA agent') }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./intake-task', () => ({ scheduleIntakeTask: vi.fn() }));
vi.mock('./automation', () => ({ processLeadStatusChanged: vi.fn() }));
const id = '10000000-0000-4000-8000-000000000001';
const intake = { kind: 'personal', source: 'referral',
  contact: { first_name: 'QA', last_name: 'Intake', phone: '(520) 555-0100', email: 'qa@example.invalid', preferred_contact: '', street: '', city: '', state: 'AZ', zip: '' },
  dob: '', marital_status: '', occupation: '', prior_limits: '', umbrella_limit: '', coverages: ['auto'],
  current: { carrier: '', expiration: '', premium: '' }, drivers: [],
  vehicles: [{ year: '2024', make: 'Honda', model: 'Civic', vin: '', use: '', ownership: '', vehicle_type: '' }], properties: [], notes: 'QA requested a vehicle quote.',
};
interface Call { table: string; method: string; body: unknown }
let calls: Call[], failAssets: boolean, failCleanup: boolean, duplicate: boolean;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; failAssets = false; failCleanup = false; duplicate = false;
  const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const table = new URL(String(input)).pathname.split('/').pop()!, method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ table, method, body });
      if (method === 'GET') return Response.json(duplicate && table === 'leads' ? [{ id, full_name: 'Existing QA', email: 'qa@example.invalid' }] : []);
      if (table === 'client_assets' && method === 'POST' && failAssets) return Response.json({ code: 'XX000', message: 'Asset save unavailable' }, { status: 500 });
      if (method === 'DELETE' && failCleanup) return Response.json({ code: 'XX000', message: 'Cleanup unavailable' }, { status: 500 });
      if (['leads', 'clients'].includes(table) && method === 'POST') return Response.json({ id, full_name: 'QA Intake', status: 'new' });
      return new Response(null, { status: 204 });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user: { id }, error: null } as Awaited<ReturnType<typeof getApiSession>>);
  vi.mocked(scheduleIntakeTask).mockResolvedValue({ created: true });
  vi.mocked(processLeadStatusChanged).mockResolvedValue(undefined);
});
const submit = (body: Record<string, unknown> = {}) => POST(new NextRequest('http://localhost/api/leads/intake', { method: 'POST', body: JSON.stringify({ intake, ...body }), headers: { 'Content-Type': 'application/json' } }));
describe('manual intake persistence', () => {
  it('saves directly to the chosen account with the complete intake, assets and note but no lead automation or policy', async () => {
    const response = await submit({ destination: 'account', intake: { ...intake, additional_details: { occupation: 'Other profession', years_at_address: '1' } } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id, destination: 'account' });
    expect(calls.find((call) => call.table === 'clients' && call.method === 'POST')?.body).toMatchObject([{
      account_type: 'personal', email_consent: false, sms_consent: false,
      intake_details: { answers: { additional_details: { occupation: 'Other profession', years_at_address: '1' } } },
    }]);
    expect(calls.find((call) => call.table === 'client_assets' && call.method === 'POST')?.body).toMatchObject([{ client_id: id, lead_id: null }]);
    expect(calls.find((call) => call.table === 'save_note_with_reminder')?.body).toMatchObject({ p_client_id: id, p_lead_id: null, p_content: intake.notes });
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.table)).not.toContain('leads');
    expect(calls.some((call) => call.table === 'policies')).toBe(false);
    expect(scheduleIntakeTask).not.toHaveBeenCalled();
    expect(processLeadStatusChanged).not.toHaveBeenCalled();
  });
  it('rolls back an incomplete account rather than leaving a hidden lead or partial intake', async () => {
    failAssets = true;
    expect((await submit({ destination: 'account' })).status).toBe(500);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.table)).toEqual(['client_assets', 'interactions', 'clients']);
  });
  it('rejects unknown destinations before any writes', async () => {
    expect((await submit({ destination: 'policy' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('saves the lead, vehicle and intake note before configuring follow-up', async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id });
    expect(calls.find((call) => call.table === 'client_assets' && call.method === 'POST')?.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ lead_id: id, metadata: expect.objectContaining({ details: expect.objectContaining({ year: '2024', make: 'Honda', model: 'Civic' }) }) }),
    ]));
    expect(calls.some((call) => call.table === 'save_note_with_reminder')).toBe(true);
    expect(scheduleIntakeTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leadId: id }));
  });
  it('checks existing records before inserting a duplicate', async () => {
    duplicate = true;
    expect((await submit()).status).toBe(409);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('keeps a completed intake and surfaces follow-up failure rather than deleting or duplicating it', async () => {
    vi.mocked(scheduleIntakeTask).mockResolvedValue({ created: false, error: 'The lead was saved, but follow-up setup failed. Review its Tasks before retrying.' });
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id, warning: expect.stringContaining('follow-up setup failed') });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
  it('never deletes a completed intake because a later notification failed', async () => {
    vi.mocked(processLeadStatusChanged).mockRejectedValue(new Error('Notification unavailable'));
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id, warning: expect.stringContaining('saved') });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
  it('removes incomplete intake records when an asset save fails', async () => {
    failAssets = true;
    expect((await submit()).status).toBe(500);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.table)).toEqual(['client_assets', 'interactions', 'leads']);
    expect(scheduleIntakeTask).not.toHaveBeenCalled();
  });
  it('explicitly reports incomplete cleanup instead of inviting another duplicate intake', async () => {
    failAssets = true; failCleanup = true;
    const response = await submit();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ id, message: expect.stringContaining('do not create a duplicate') });
  });
});
