import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { requireAgencyReportsAccess } from './agency-access';

const userId = '00000000-0000-4000-8000-000000000001';

function clientFor(role: string, active: boolean) {
  const fetcher: typeof fetch = async () => Response.json([{
    user_id: userId,
    email: 'agent@example.invalid',
    role,
    active,
    sender_profile: null,
    gmail_ai_opt_in: false,
  }]);
  return createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe('agency-wide report access', () => {
  it.each(['owner', 'admin'])('allows active %s members', async (role) => {
    const member = await requireAgencyReportsAccess(clientFor(role, true), userId);
    expect(member.role).toBe(role);
  });

  it.each(['agent', 'inactive owner'])('rejects %s access', async (caseName) => {
    const active = caseName !== 'inactive owner';
    const role = caseName === 'inactive owner' ? 'owner' : 'agent';
    await expect(requireAgencyReportsAccess(clientFor(role, active), userId)).rejects.toMatchObject({ status: 403 });
  });
});
