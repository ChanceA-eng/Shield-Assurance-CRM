import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readRenewalEvidence, renewalEvidenceLabel } from '@crm/shared';
import { buildProspects, parseVendorDate } from './lead-import';
import { classifiedImportProfile, importMatches, importRenewalTasks } from './import-intelligence';
import { buildGrounding } from './outreach-ai';

describe('renewal evidence boundaries', () => {
  it('classifies vendor predictions and preserves field provenance', () => {
    const prospects = buildProspects([{ 'Prospect Name': 'Example', 'Contact First Name': 'Synthetic',
      'Contact Email': 'test@example.invalid', 'General Liability X-Date Prediction': '4/22/2027', 'WC Renewal': '3/10/2027' }], 'commercial');
    const evidence = readRenewalEvidence(prospects[0].profile.renewals);
    expect(evidence).toContainEqual(expect.objectContaining({ evidence_class: 'predicted', precision: 'month', source_field: 'General Liability X-Date Prediction' }));
    expect(evidence).toContainEqual(expect.objectContaining({ evidence_class: 'vendor_reported', precision: 'date' }));
    expect(renewalEvidenceLabel(evidence.find((item) => item.evidence_class === 'predicted')!)).toBe('Predicted month: 2027-04');
  });
  it.each(['2/30/2027', '2027-02-29', '2027-13-01', '04/31/2027'])('quarantines invalid dates %s from actionable renewals', (date) => {
    expect(parseVendorDate(date)).toBeNull();
    expect(readRenewalEvidence([{ type: 'Workers Comp', date }])).toEqual([]);
    expect(buildProspects([{ 'Prospect Name': 'Synthetic', 'WC Renewal': date }], 'commercial')[0].profile.invalid_renewal_fields).toEqual(['WC Renewal']);
  });
  it('does not upgrade imported claims to confirmation', () => {
    const result = classifiedImportProfile({ renewals: [{ type: 'Workers Comp', date: '2027-05-01',
      evidence_class: 'confirmed', confirmed_by: 'Vendor', confirmed_on: '2026-11-05' }] });
    expect(readRenewalEvidence(result.renewals)[0].evidence_class).toBe('vendor_reported');
  });
  it('retains genuine confirmation provenance without treating it as a legacy GL prediction', () => {
    const evidence = readRenewalEvidence([{ type: 'General Liability', date: '2027-05-01',
      evidence_class: 'confirmed', confirmed_by: 'Agent', confirmed_on: '2026-11-05' }]);
    expect(readRenewalEvidence(evidence)[0]).toMatchObject({ evidence_class: 'confirmed', precision: 'date', confirmed_by: 'Agent' });
    expect(readRenewalEvidence(classifiedImportProfile({ renewals: evidence }).renewals)[0].evidence_class).toBe('vendor_reported');
  });
  it('keeps different street-address branches separate even in the same ZIP', () => {
    const rows = ['1 Main Street', '2 Main Street'].map((address) => ({
      'Prospect Name': 'Same company', Address: address, Zip: '85701',
      'Contact First Name': 'Synthetic', 'Contact Email': 'contact@example.invalid',
    }));
    expect(buildProspects(rows, 'commercial')).toHaveLength(2);
  });
  it('uses Arizona timing and cautious task wording, retaining conflicts', () => {
    const tasks = importRenewalTasks('Example', { renewals: [
      { type: 'General Liability', date: '2027-04-22', carrier: 'Reported market' },
      { type: 'Workers Comp', date: '2027-04-22', carrier: 'Market A' },
      { type: 'Workers Comp', date: '2027-05-22', carrier: 'Market B' },
    ] }, new Date('2026-11-05T08:00:00Z'));
    expect(tasks).toHaveLength(3);
    expect(tasks[0].description).toContain('Predicted month: 2027-04');
    expect(tasks[0].description).not.toContain('2027-04-22');
    expect(tasks[0].due_date).toBe('2027-01-31T16:00:00.000Z');
    expect(tasks[1].description).toContain('Vendor-reported date');
    expect(tasks[1].description).not.toContain('currently with');
  });
  it('preserves numeric enrichment and labels predictions in AI grounding', () => {
    const grounding = buildGrounding({ full_name: 'Synthetic', form_payload: { profile: {
      kind: 'commercial', renewals: [{ type: 'General Liability', date: '2027-04-22' }],
      enrichment: { fmcsa: { dot_number: '123', power_units: 12, drivers: 0 } },
    } } });
    expect(grounding).toContain('Predicted month: 2027-04');
    expect(grounding).not.toContain('2027-04-22');
    expect(grounding).toContain('power units (source reported): 12');
    expect(grounding).toContain('drivers (source reported): 0');
  });
});

describe('complete-book matching contract', () => {
  it('chunks requested candidates without scanning a capped book and retains ambiguous matches', async () => {
    let calls = 0;
    const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
      fetch: async (_input, init) => {
        calls++;
        const body = JSON.parse(String(init?.body)) as { p_candidates: Array<{ index: number }> };
        return new Response(JSON.stringify(body.p_candidates.map((candidate) => ({
          index: candidate.index, matches: candidate.index === 200 ? ['lead:168413e9-a6a4-4dff-a8bf-8f8df83dace6', 'client:168413e9-a6a4-4dff-a8bf-8f8df83dace7'] : [],
        }))), { headers: { 'Content-Type': 'application/json' } });
      },
    } });
    const results = await importMatches(db, Array.from({ length: 201 }, () => ({ full_name: 'Synthetic', email: null, phone: null, address: null })), 'actor');
    expect(calls).toBe(2);
    expect(results.get(200)).toEqual(['lead:168413e9-a6a4-4dff-a8bf-8f8df83dace6', 'client:168413e9-a6a4-4dff-a8bf-8f8df83dace7']);
  });
  it('fails explicitly instead of staging when match service fails', async () => {
    const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
      fetch: async () => new Response(JSON.stringify({ code: 'XX000', message: 'unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
    } });
    await expect(importMatches(db, [{ full_name: 'Synthetic', email: null, phone: null, address: null }], 'actor')).rejects.toMatchObject({ status: 500 });
  });
  it.each([
    [{ index: 0, matches: [] }, { index: 0, matches: [] }],
    [{ index: 0, matches: [] }, { index: 2, matches: [] }],
    [{ index: 0, matches: ['lead:not-an-id'] }, { index: 1, matches: [] }],
  ])('rejects incomplete or malformed review results', async (...rows) => {
    const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
      fetch: async () => new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } }),
    } });
    await expect(importMatches(db, Array.from({ length: 2 }, () => ({ full_name: 'Synthetic', email: null, phone: null, address: null })), 'actor')).rejects.toMatchObject({ status: 503 });
  });
});
