import { describe, expect, it } from 'vitest';
import { requireAgencyReportsAccess } from './agency-access';

describe('agency-wide report access', () => {
  it('allows the reports grant regardless of membership title', () => {
    expect(() => requireAgencyReportsAccess({ mode: 'restricted', grants: { 'reports.view': 'agency' } })).not.toThrow();
  });

  it('rejects missing report grants and preserves legacy access during staged rollout', () => {
    expect(() => requireAgencyReportsAccess({ mode: 'restricted', grants: {} })).toThrowError();
    expect(() => requireAgencyReportsAccess({ mode: 'legacy' })).not.toThrow();
  });
});
