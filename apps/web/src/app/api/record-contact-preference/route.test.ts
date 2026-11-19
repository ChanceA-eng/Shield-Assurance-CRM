import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { activeAgencyMember } from '../../../lib/agency-membership';

vi.mock('../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../lib/supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('../../../lib/agency-membership', () => ({ activeAgencyMember: vi.fn() }));

const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const lead = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const account = '168413e9-a6a4-4dff-a8bf-8f8df83dace8';
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function database({ inherited = false, foreign = false, missing = false } = {}) {
  const mutations: unknown[] = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const name = url.pathname.split('/').pop();
      if (name === 'set_record_contact_preference') { mutations.push(JSON.parse(String(init?.body))); return json(null); }
      if (name === 'lead_contact_restrictions') return json([{ lead_id: lead, do_not_contact: inherited }]);
      if (name === 'leads') return json({ id: lead, agent_user_id: foreign ? account : actor, account_id: account });
      if (name === 'record_contact_preferences') {
        if (missing) return json({ code: 'PGRST205', message: 'table missing' }, 404);
        return json(url.searchParams.has('client_id') && inherited ? { do_not_contact: true, reason: 'Account request' } : null);
      }
      return json({ message: 'Unexpected request' }, 500);
    } },
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue(client);
  return mutations;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({
    user: { id: actor, aud: 'authenticated', created_at: '', app_metadata: {}, user_metadata: {} }, error: null,
  });
  vi.mocked(activeAgencyMember).mockResolvedValue({
    user_id: actor, email: 'synthetic@example.invalid', role: 'agent', active: true, sender_profile: null, gmail_ai_opt_in: false,
  });
});

describe('contact preference API', () => {
  it('reports inherited account restrictions rather than offering a lead-level bypass', async () => {
    database({ inherited: true });
    const response = await GET(new NextRequest(`http://localhost/api/record-contact-preference?type=lead&id=${lead}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ do_not_contact: true, inherited: true });
  });
  it('persists changes through the audited RPC with the session actor', async () => {
    const mutations = database();
    const response = await PUT(new NextRequest('http://localhost/api/record-contact-preference', {
      method: 'PUT', body: JSON.stringify({ type: 'lead', id: lead, do_not_contact: true }),
    }));
    expect(response.status).toBe(200);
    expect(mutations).toEqual([{ p_actor: actor, p_type: 'lead', p_id: lead, p_do_not_contact: true, p_reason: '' }]);
  });
  it('rejects another agent record before changing it', async () => {
    const mutations = database({ foreign: true });
    const response = await PUT(new NextRequest('http://localhost/api/record-contact-preference', {
      method: 'PUT', body: JSON.stringify({ type: 'lead', id: lead, do_not_contact: false }),
    }));
    expect(response.status).toBe(404);
    expect(mutations).toEqual([]);
  });
  it('fails closed without exposing database setup instructions to agents', async () => {
    database({ missing: true });
    const response = await GET(new NextRequest(`http://localhost/api/record-contact-preference?type=lead&id=${lead}`));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.message).toBe('Contact preferences are temporarily unavailable. Please try again.');
    expect(body).not.toHaveProperty('do_not_contact');
    expect(body.message).not.toMatch(/migration|20261113|database/i);
  });
});
