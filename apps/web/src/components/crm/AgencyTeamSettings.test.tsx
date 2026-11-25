import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import AgencyTeamSettings from './AgencyTeamSettings';
import type { TeamMember } from '../../lib/team-settings';

vi.mock('../../context/WorkspaceNavigationContext', () => ({
  useUnsavedChanges: () => ({ confirmDiscard: () => true }),
}));

afterEach(() => vi.unstubAllGlobals());

it('server-renders the roster and add-member action without an inline permission grid', () => {
  vi.stubGlobal('React', React);
  const owner: TeamMember = { user_id: 'owner', email: 'owner@example.invalid', role: 'owner', active: true,
    team_name: null, role_title: null, direct_grants: null, setup_state: null, access_version: 1, invitation_id: null };
  const html = renderToStaticMarkup(<AgencyTeamSettings initial={{ owner: true, managerGrants: null, invitationIssue: null, activity: [], presets: [], members: [
    owner, { ...owner, user_id: 'staff', email: 'staff@example.invalid', role: 'agent', team_name: 'Sample Member', role_title: 'Renewal Coordinator',
      direct_grants: {}, setup_state: 'accepted' },
  ] }} />);
  expect(html).toContain('Renewal Coordinator');
  expect(html).toContain('Add member');
  expect(html).not.toContain('Starting permissions');
  expect(html).toContain('Protected access');
  expect(html.match(/>Edit access</g)).toHaveLength(1);
});

it('counts pending, failed and deactivated members without counting revoked invitations as deactivated', () => {
  vi.stubGlobal('React', React);
  const member: TeamMember = { user_id: 'owner', email: 'owner@example.invalid', role: 'owner', active: true,
    team_name: null, role_title: null, direct_grants: null, setup_state: null, access_version: 1, invitation_id: null };
  const html = renderToStaticMarkup(<AgencyTeamSettings initial={{ owner: true, managerGrants: null, invitationIssue: null, activity: [], presets: [], members: [
    member,
    { ...member, user_id: 'pending', role: 'agent', active: false, setup_state: 'sent' },
    { ...member, user_id: 'failed', role: 'agent', active: false, setup_state: 'delivery_failed' },
    { ...member, user_id: 'inactive', role: 'agent', active: false, setup_state: 'accepted' },
    { ...member, user_id: 'revoked', role: 'agent', active: false, setup_state: 'revoked' },
  ] }} />);
  for (const label of ['Active members', 'Awaiting setup', 'Setup issues', 'Deactivated']) {
    expect(html).toMatch(new RegExp(`${label}</span><strong[^>]*>1</strong>`));
  }
});

it('hides deactivated and revoked people from the current roster by default', () => {
  vi.stubGlobal('React', React);
  const member: TeamMember = { user_id: 'owner', email: 'owner@example.invalid', role: 'owner', active: true,
    team_name: null, role_title: null, direct_grants: null, setup_state: null, access_version: 1, invitation_id: null };
  const html = renderToStaticMarkup(<AgencyTeamSettings initial={{ owner: true, managerGrants: null, invitationIssue: null, activity: [], presets: [], members: [
    member,
    { ...member, user_id: 'former', email: 'former@example.invalid', role: 'agent', active: false, setup_state: 'accepted' },
    { ...member, user_id: 'revoked', email: 'revoked@example.invalid', role: 'agent', active: false, setup_state: 'revoked' },
  ] }} />);
  expect(html).toContain('owner@example.invalid');
  expect(html).not.toContain('former@example.invalid');
  expect(html).not.toContain('revoked@example.invalid');
  expect(html).toContain('>Deactivated</option>');
  expect(html).toContain('>Invitation revoked</option>');
});
