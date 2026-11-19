import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { permitsTeamRequest, readTeamRequestAccess } from './team-request-access';

describe('restricted team request authorization', () => {
  const memberId = 'c71bc0f5-a3df-4b9c-9a7c-5d4f7c24a3ce';
  it('lets a reviewer read marketing content without editing, dispatching, or accessing customer data', () => {
    const reviewer = { mode: 'restricted' as const, grants: { 'social.view': 'agency' } };
    expect(permitsTeamRequest(reviewer, '/api/social-marketing/drafts', 'GET')).toBe(true);
    expect(permitsTeamRequest(reviewer, '/api/social-marketing/media', 'POST')).toBe(false);
    for (const [path, method] of [
      ['/api/social-marketing/engine', 'POST'], ['/api/clients/directory', 'GET'],
      ['/api/clients/example/files/example/download', 'GET'], ['/api/shell', 'GET'],
      ['/api/notifications', 'GET'], ['/api/metrics/home', 'GET'],
    ]) expect(permitsTeamRequest(reviewer, path, method)).toBe(false);
  });

  it('does not silently allow unverified CRM routes based on broad or assigned grants', () => {
    const member = { mode: 'restricted' as const, grants: { 'accounts.view': 'assigned', 'documents.view': 'agency' } };
    expect(permitsTeamRequest(member, '/api/clients', 'GET')).toBe(false);
    expect(permitsTeamRequest(member, '/api/unclassified', 'GET')).toBe(false);
    expect(permitsTeamRequest(member, '/api/account', 'GET')).toBe(true);
  });

  it('admits only account document reads to the scoped handlers', () => {
    const member = { mode: 'restricted' as const, grants: { 'accounts.view': 'assigned', 'documents.view': 'agency' } };
    expect(permitsTeamRequest(member, '/api/clients/example/files', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/api/clients/example/files/example/download', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/api/clients/example/files', 'POST')).toBe(false);
    expect(permitsTeamRequest(member, '/api/questionnaires/files/example', 'GET')).toBe(false);
  });

  it.each([{ code: '42501', status: 403 }, { code: 'PGRST202', status: 404 }])(
    'does not grant legacy access when the authorization RPC fails with $code', async ({ code, status }) => {
      const db = createClient('https://example.supabase.co', 'test-key', {
        auth: { persistSession: false },
        global: { fetch: async (input) => String(input).includes('/agency_members')
          ? Response.json([]) : Response.json({ code }, { status }) },
      });
      await expect(readTeamRequestAccess(db, memberId)).rejects.toThrow('Team authorization is unavailable');
    },
  );

  it('preserves verified owner access during a missing migration or stale schema cache', async () => {
    const db = createClient('https://example.supabase.co', 'test-key', {
      auth: { persistSession: false },
      global: { fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/rpc/team_request_access')) return Response.json({ code: 'PGRST202' }, { status: 404 });
        expect(url.pathname).toBe('/rest/v1/agency_members');
        expect(url.searchParams.get('user_id')).toBe(`eq.${memberId}`);
        expect(url.searchParams.get('role')).toBe('eq.owner');
        expect(url.searchParams.get('active')).toBe('eq.true');
        return Response.json([{ user_id: memberId }]);
      } },
    });
    await expect(readTeamRequestAccess(db, memberId)).resolves.toEqual({ mode: 'legacy', verifiedOwnerFallback: true });
  });
});
