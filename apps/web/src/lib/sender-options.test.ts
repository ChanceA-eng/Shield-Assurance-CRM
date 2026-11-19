import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { senderOptions } from './sender-options';

describe('saved sender suggestions', () => {
  it('uses saved profile values and a real account display name, not invented access roles', () => {
    const options = senderOptions([DEFAULT_OUTREACH_SENDER, { ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', role: 'Principal agent' }], 'Signed-in owner');
    expect(options.name).toEqual(['Chance', 'Signed-in owner', 'Taylor']);
    expect(options.role).toEqual(['Insurance producer', 'Principal agent']);
    expect(options.role).not.toContain('Superadmin');
    expect(options.agency).toEqual(['Shield Assurance']);
  });
  it('does not flatten stored multiline content or mutate saved profiles', () => {
    const profile = { ...DEFAULT_OUTREACH_SENDER, specialties: 'Auto\nCommercial', service_area: '', tone: 'Two\nlines' };
    expect(senderOptions([profile])).toMatchObject({ specialties: [], service_area: [], tone: [] });
    expect(profile.specialties).toBe('Auto\nCommercial');
    expect(profile.tone).toBe('Two\nlines');
  });
});
