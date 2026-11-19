import { describe, expect, it } from 'vitest';
import { CRM_HELP, crmHelpAnswer, isCrmHelpRequest } from './crm-help';

describe('grounded CRM help', () => {
  it('answers tool questions without a model or deployment claims', () => {
    expect(crmHelpAnswer('How do I set up agency email replies?')).toBe(CRM_HELP.email.answer);
    expect(crmHelpAnswer('Where are source approvals?')).toBe(CRM_HELP.sources.answer);
    expect(crmHelpAnswer('Help with custom workflows')).toBe(CRM_HELP.workflows.answer);
    expect(crmHelpAnswer('How do I upload workers comp documents?')).toBe(CRM_HELP.workers_comp.answer);
    expect(crmHelpAnswer('Explain CRM settings')).toBe(CRM_HELP.settings.answer);
  });
  it('leaves underwriting, document and unrelated questions in the existing knowledge flow', () => {
    for (const question of ['What exclusions apply to workers comp?', 'How is the experience mod calculated?',
      'How much is workers comp premium?', 'Explain policy wording in this template', 'What is the Arizona capital?']) {
      expect(crmHelpAnswer(question)).toBeNull();
    }
  });
  it('accepts known help events but rejects unknown topics and oversized diagnostics', () => {
    expect(isCrmHelpRequest({ topic: 'research', detail: 'Lookup unavailable.' })).toBe(true);
    expect(isCrmHelpRequest({ topic: 'email', detail: undefined })).toBe(true);
    expect(isCrmHelpRequest({ topic: 'constructor' })).toBe(false);
    expect(isCrmHelpRequest({ topic: 'email', detail: 'a'.repeat(8001) })).toBe(false);
    expect(isCrmHelpRequest(null)).toBe(false);
  });
});
