import { describe, expect, it } from 'vitest';
import { parseWcEvidence, suggestWcFields, wcEntryStatus, wcMatchingFacts, type WcEntry, type WcEvidence } from './workers-comp';

const today = '2026-11-17';
function evidence(patch: Partial<WcEvidence> = {}): WcEvidence {
  return { kind: 'policy', source_name: 'Synthetic employer document', source_date: today,
    employer_name: 'Synthetic Employer LLC', employer_address: '1 Test St, Tucson, AZ 85701',
    identity: 'confirmed', fields: {}, pages: {}, ...patch };
}
function entry(patch: Partial<WcEvidence> = {}): WcEntry {
  return { id: 'synthetic', revision: 1, evidence: evidence(patch), updated_at: `${today}T12:00:00Z` };
}

describe('private workers comp evidence', () => {
  it('keeps an explicit reported zero separate from missing and partial loss history', () => {
    const complete = parseWcEvidence(evidence({ kind: 'loss_run', fields: {
      claim_count: '0', paid_losses: '0', loss_from: '2025-01-01', loss_to: '2025-12-31', loss_completeness: 'complete',
    } }), today);
    expect(complete.fields.claim_count).toBe('0');
    expect(complete.fields.open_claims).toBeUndefined();
    expect(wcMatchingFacts([entry(complete)], today).facts.has_prior_losses).toBeUndefined();
    expect(() => parseWcEvidence(evidence({ kind: 'loss_run', fields: { claim_count: '0' } }), today)).toThrow('loss period');
    expect(() => parseWcEvidence(evidence({ kind: 'loss_run', fields: {
      claim_count: '1', open_claims: '2', loss_from: '2025-01-01', loss_to: '2025-12-31', loss_completeness: 'partial',
    } }), today)).toThrow('cannot exceed');
  });
  it('rejects invalid dates, future report dates, unexpected fields and orphan citations', () => {
    expect(() => parseWcEvidence(evidence({ source_date: '2026-11-18' }), today)).toThrow('future');
    expect(() => parseWcEvidence(evidence({ fields: { policy_from: '2026-02-30' } }), today)).toThrow('valid');
    expect(() => parseWcEvidence(evidence({ fields: { policy_from: '2026-12-01', policy_to: '2026-01-01' } }), today)).toThrow('period end');
    expect(() => parseWcEvidence({ ...evidence(), fields: { claimant_name: 'Do not retain' } }, today)).toThrow('employer-level');
    expect(() => parseWcEvidence(evidence({ pages: { carrier: 2 } }), today)).toThrow('page');
    expect(() => parseWcEvidence(evidence({ kind: 'payroll', fields: { payroll: '2000' } }), today)).toThrow('basis and period');
    expect(() => parseWcEvidence(evidence({ fields: { class_codes: '8810' } }), today)).toThrow('state');
  });
  it('holds stale, possible, future and historical evidence out of automated comparisons', () => {
    const doc = { kind: 'mod' as const, fields: { experience_mod: '0.85', mod_from: '2026-01-01', mod_to: '2026-12-31' } };
    for (const patch of [
      { ...doc, identity: 'possible' as const }, { ...doc, source_date: '2026-01-01' },
      { ...doc, fields: { ...doc.fields, mod_from: '2027-01-01', mod_to: '2027-12-31' } },
      { ...doc, fields: { ...doc.fields, mod_to: '2026-01-02' } },
    ]) expect(wcMatchingFacts([entry(patch)], today).facts.experience_mod).toBeUndefined();
    expect(wcEntryStatus(entry({ fields: { policy_to: '2025-01-01' } }), today)).toBe('Historical period');
  });
  it('compares current mods and audited annual payroll without choosing conflicting facts', () => {
    const mod = entry({ kind: 'mod', fields: { experience_mod: '0.85', mod_from: '2026-01-01', mod_to: '2026-12-31' } });
    const payroll = entry({ kind: 'payroll', fields: { payroll: '1000000', payroll_basis: 'audited', payroll_from: '2025-01-01', payroll_to: '2025-12-31' } });
    expect(wcMatchingFacts([mod, payroll], today).facts).toMatchObject({ experience_mod: '0.85', annual_payroll: '1000000' });
    const conflict = entry({ ...mod.evidence, fields: { ...mod.evidence.fields, experience_mod: '1.2' } });
    expect(wcMatchingFacts([mod, conflict], today)).toMatchObject({ facts: { state: 'AZ' }, conflicts: [expect.stringContaining('Different experience mod')] });
    expect(wcMatchingFacts([mod, conflict], today).facts.experience_mod).toBeUndefined();
    expect(wcMatchingFacts([entry({ kind: 'payroll', fields: { ...payroll.evidence.fields, payroll_basis: 'estimated' } })], today).facts.annual_payroll).toBeUndefined();
  });
  it('does not silently select one class from several or use another state class', () => {
    expect(wcMatchingFacts([entry({ fields: { class_codes: '8810, 8742', class_state: 'AZ' } })], today).facts.class_code).toBeUndefined();
    expect(wcMatchingFacts([entry({ fields: { class_codes: '8810', class_state: 'CA' } })], today).facts.class_code).toBeUndefined();
  });
  it('suggests only unambiguous labeled totals with page references, never individual claims', () => {
    expect(suggestWcFields([{ page: 2, text: 'Total claims: 0\nTotal paid: $0.00\nJane Doe paid: 55\nExperience Mod: 0.8' }], 'loss_run'))
      .toEqual({ fields: { claim_count: '0', paid_losses: '0.00' }, pages: { claim_count: 2, paid_losses: 2 } });
    expect(suggestWcFields([{ page: 1, text: 'Experience Mod: 0.85' }, { page: 2, text: 'Experience Mod: 1.10' }], 'mod').fields).toEqual({});
  });
});
