import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { permitsTeamRequest, readTeamRequestAccess } from './team-request-access';
import { canAccessTeamPage } from './team-page-access';

describe('restricted team request authorization', () => {
  it('admits delegated Team administrators only to the checked Team handler, not unrelated settings APIs', () => {
    const manager = { mode: 'restricted' as const, grants: { 'team.manage': 'agency' } };
    expect(permitsTeamRequest(manager, '/settings', 'GET')).toBe(true);
    expect(permitsTeamRequest(manager, '/api/agency', 'POST')).toBe(true);
    expect(permitsTeamRequest(manager, '/api/agency', 'GET', 'team=true')).toBe(true);
    expect(permitsTeamRequest(manager, '/api/settings/outreach', 'POST')).toBe(false);
    expect(permitsTeamRequest({ mode: 'restricted', grants: {} }, '/api/agency', 'POST')).toBe(false);
    expect(permitsTeamRequest({ mode: 'restricted', grants: { 'integrations.manage': 'agency' } }, '/settings', 'GET', 'tab=integrations')).toBe(true);
    expect(permitsTeamRequest({ mode: 'restricted', grants: { 'integrations.manage': 'agency' } }, '/settings', 'GET')).toBe(false);
  });

  it('uses the selected record type and operation grant for assignments and contact preferences', () => {
    const assigned = { mode: 'restricted' as const, grants: {
      'leads.view': 'assigned', 'leads.edit': 'assigned', 'leads.assign': 'agency',
      'accounts.view': 'assigned', 'accounts.edit': 'assigned',
    } };
    expect(permitsTeamRequest(assigned, '/api/agency/assignment', 'GET', 'record_type=lead')).toBe(true);
    expect(permitsTeamRequest(assigned, '/api/agency/assignment', 'GET', 'record_type=client')).toBe(false);
    expect(permitsTeamRequest(assigned, '/api/agency', 'PATCH')).toBe(true);
    expect(permitsTeamRequest(assigned, '/api/record-contact-preference', 'GET', 'type=lead')).toBe(true);
    expect(permitsTeamRequest(assigned, '/api/record-contact-preference', 'GET', 'type=client')).toBe(true);
    expect(permitsTeamRequest(assigned, '/api/record-contact-preference', 'PUT')).toBe(true);
    expect(permitsTeamRequest({ mode: 'restricted', grants: { 'leads.view': 'assigned' } },
      '/api/record-contact-preference', 'PUT')).toBe(false);
  });
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

  it('grants training and personal progress without exposing the course editor or other knowledge APIs', () => {
    const member = { mode: 'restricted' as const, grants: { 'knowledge.view': 'agency' } };
    expect(permitsTeamRequest(member, '/learning', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/learning/module/1/assessment', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/learning/course-builder', 'GET')).toBe(false);
    expect(permitsTeamRequest(member, '/api/learning/progress/update', 'POST')).toBe(true);
    expect(permitsTeamRequest(member, '/api/learning/static-assessments/1', 'POST')).toBe(true);
    expect(permitsTeamRequest(member, '/api/learning/courses/create', 'POST')).toBe(false);
    expect(permitsTeamRequest(member, '/api/learning/snapshots/list', 'GET')).toBe(false);
    expect(permitsTeamRequest({ mode: 'restricted', grants: {} }, '/learning', 'GET')).toBe(false);
  });

  it('admits only account document reads to the scoped handlers', () => {
    const member = { mode: 'restricted' as const, grants: { 'accounts.view': 'assigned', 'documents.view': 'agency' } };
    expect(permitsTeamRequest(member, '/api/clients/example/files', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/api/clients/example/files/example/download', 'GET')).toBe(true);
    expect(permitsTeamRequest(member, '/api/clients/example/files', 'POST')).toBe(false);
    expect(permitsTeamRequest(member, '/api/questionnaires/files/example', 'GET')).toBe(false);
  });

  it('applies page and API grants at the selected scope without opening agency-wide surfaces', () => {
    const taskMember = { mode: 'restricted' as const, grants: { 'tasks.view': 'self', 'tasks.edit': 'self' } };
    expect(canAccessTeamPage(taskMember, '/tasks')).toBe(true);
    expect(canAccessTeamPage(taskMember, '/workday')).toBe(false);
    expect(permitsTeamRequest(taskMember, '/api/tasks', 'GET')).toBe(true);
    expect(permitsTeamRequest(taskMember, '/api/metrics/tasks', 'GET')).toBe(false);
    expect(permitsTeamRequest(taskMember, '/api/tasks/bulk-reschedule', 'PATCH')).toBe(false);

    const assigned = { mode: 'restricted' as const, grants: { 'leads.view': 'assigned', 'leads.edit': 'assigned' } };
    expect(canAccessTeamPage(assigned, '/leads')).toBe(true);
    expect(canAccessTeamPage(assigned, '/reports')).toBe(false);
    expect(permitsTeamRequest(assigned, '/api/leads', 'GET')).toBe(false);
    expect(permitsTeamRequest(assigned, '/api/leads/example', 'GET')).toBe(false);
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
