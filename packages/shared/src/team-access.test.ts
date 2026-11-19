import { describe, expect, it } from 'vitest';
import {
  STARTER_TEAM_ROLES, assertTeamDelegation, hasTeamPermission, resolveTeamAccess,
  parseTeamExceptions, parseTeamGrants, validateSocialPublishConfirmation, validateTeamAccess,
} from './team-access';

describe('Team access bundles and exceptions', () => {
  it('lets producers work across the agency while keeping content roles away from customer data', () => {
    for (const role of STARTER_TEAM_ROLES) validateTeamAccess(resolveTeamAccess(role.grants));
    const producer = resolveTeamAccess(STARTER_TEAM_ROLES.find((role) => role.id === 'producer')!.grants);
    expect(hasTeamPermission(producer, 'leads.view', 'agency')).toBe(true);
    expect(hasTeamPermission(producer, 'accounts.view', 'agency')).toBe(true);
    expect(hasTeamPermission(producer, 'team.manage', 'agency')).toBe(false);
    for (const id of ['content-writer', 'social-marketer', 'read-only-reviewer']) {
      const access = resolveTeamAccess(STARTER_TEAM_ROLES.find((role) => role.id === id)!.grants);
      expect(hasTeamPermission(access, 'social.view', 'agency')).toBe(true);
      for (const permission of ['accounts.view', 'leads.view', 'documents.view', 'messages.view', 'social.approve', 'social.publish', 'social.publish_direct'] as const) {
        expect(hasTeamPermission(access, permission, 'agency')).toBe(false);
      }
    }
  });

  it('removes denied grants and permits an explicit narrower member scope', () => {
    const access = resolveTeamAccess([
      { permission: 'accounts.view', scope: 'agency' }, { permission: 'accounts.edit', scope: 'agency' },
    ], [{ permission: 'accounts.view', effect: 'allow', scope: 'assigned' }, { permission: 'accounts.edit', effect: 'deny' }]);
    validateTeamAccess(access);
    expect(hasTeamPermission(access, 'accounts.view', 'assigned')).toBe(true);
    expect(hasTeamPermission(access, 'accounts.view', 'agency')).toBe(false);
    expect(hasTeamPermission(access, 'accounts.edit', 'assigned')).toBe(false);
  });

  it('rejects indirect escalation and incompatible dependency scopes', () => {
    expect(() => assertTeamDelegation({ 'accounts.view': 'assigned' }, { 'accounts.view': 'agency' })).toThrow('beyond your own access');
    expect(() => assertTeamDelegation({ 'social.view': 'agency' }, { 'social.view': 'agency', 'social.publish': 'agency' })).toThrow('beyond your own access');
    expect(() => validateTeamAccess({ 'accounts.view': 'assigned', 'accounts.edit': 'agency' })).toThrow('same or wider scope');
    expect(() => validateTeamAccess({ 'social.view': 'agency', 'social.publish_direct': 'agency' })).toThrow('Publish approved');
    expect(() => resolveTeamAccess([{ permission: 'social.view', scope: 'self' }])).toThrow('valid scope');
  });

  it('rejects conflicting duplicate exceptions instead of depending on their order', () => {
    expect(() => resolveTeamAccess([], [
      { permission: 'accounts.view', effect: 'deny' }, { permission: 'accounts.view', effect: 'allow', scope: 'agency' },
    ])).toThrow('one exception');
  });

  it('validates untrusted grant and exception payloads before evaluating access', () => {
    expect(parseTeamGrants({ 'accounts.view': 'assigned' })).toEqual([{ permission: 'accounts.view', scope: 'assigned' }]);
    expect(parseTeamExceptions({ 'accounts.edit': { effect: 'deny' } })).toEqual([{ permission: 'accounts.edit', effect: 'deny' }]);
    expect(parseTeamExceptions({ 'accounts.view': { effect: 'allow', scope: 'assigned' } }))
      .toEqual([{ permission: 'accounts.view', effect: 'allow', scope: 'assigned' }]);
    for (const invalid of [{ 'constructor': 'agency' }, { 'unknown.access': 'agency' }, { 'accounts.edit': 'agency' }, []]) {
      expect(() => parseTeamGrants(invalid)).toThrow();
    }
    for (const invalid of [
      { 'social.view': { effect: 'allow', scope: 'self' } },
      { 'accounts.edit': { effect: 'deny', scope: 'agency' } },
      { 'accounts.view': { effect: 'allow', scope: 'agency', actor: 'owner' } },
    ]) expect(() => parseTeamExceptions(invalid)).toThrow();
  });
});

describe('Exact-post publishing checklist', () => {
  const confirmation = {
    checklist_version: 1, checks: { destination: true, content: true, compliance: true, rights: true },
    post_id: '5ca90410-8257-4eea-94ed-b89cc97158c1', revision: 3,
    connection_id: '6a7f2bc4-94b0-4de9-adc9-ae1885c0845d',
  };
  it('requires explicit checks bound to a post revision and destination', () => {
    expect(validateSocialPublishConfirmation(confirmation)).toEqual(confirmation);
    for (const invalid of [
      { ...confirmation, checks: { ...confirmation.checks, rights: false } },
      { ...confirmation, checks: { ...confirmation.checks, rights: 'true' } },
      { ...confirmation, checklist_version: 0 }, { ...confirmation, revision: 1.2 },
      { ...confirmation, revision: 2147483647 },
      { ...confirmation, connection_id: null }, { ...confirmation, actor_id: confirmation.post_id },
    ]) expect(() => validateSocialPublishConfirmation(invalid)).toThrow();
  });
});
