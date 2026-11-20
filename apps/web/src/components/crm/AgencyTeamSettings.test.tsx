import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import AgencyTeamSettings from './AgencyTeamSettings';
import type { TeamMember } from '../../lib/team-settings';

vi.mock('../../context/WorkspaceNavigationContext', () => ({
  useUnsavedChanges: () => ({ confirmDiscard: () => true }),
}));

afterEach(() => vi.unstubAllGlobals());

it('server-renders the website-style roster with a freeform title, unchecked permissions, and a protected owner', () => {
  vi.stubGlobal('React', React);
  const owner: TeamMember = { user_id: 'owner', email: 'owner@example.invalid', role: 'owner', active: true,
    team_name: null, role_title: null, direct_grants: null, setup_state: null, access_version: 1, invitation_id: null };
  const html = renderToStaticMarkup(<AgencyTeamSettings initial={{ owner: true, managerGrants: null, invitationIssue: null, activity: [], members: [
    owner, { ...owner, user_id: 'staff', email: 'staff@example.invalid', role: 'agent', team_name: 'Sample Member', role_title: 'Renewal Coordinator',
      direct_grants: {}, setup_state: 'accepted' },
  ] }} />);
  expect(html).toContain('Type any role title');
  expect(html).toContain('Renewal Coordinator');
  expect(html).toContain('Starting permissions');
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('checked=""');
  expect(html).not.toContain('Producer');
  expect(html).toContain('Protected access');
  expect(html.match(/>Edit access</g)).toHaveLength(1);
});
