import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { EMPTY_DOSSIER_FINDINGS, type IntelligenceDossier, type DossierObservation } from '@crm/shared';
import { currentDossierDraftFacts, dossierBriefing, parseDossierFindings } from './dossier';
import { getSupabaseServerClient } from './supabase-server';
import { GET, POST } from '../app/api/intelligence/dossier/route';
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: 'actor' }, error: null }) }));
const id = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const dossier = (observations: DossierObservation[] = []): IntelligenceDossier => ({
  scope_key: `lead:${id}`, record_name: 'Synthetic', version: 0, findings: { ...EMPTY_DOSSIER_FINDINGS },
  confirmations: [], observations, observations_total: observations.length, history_total: 0, page: 0,
});
const observation = (key: string, date: string, units: number, dot = '123'): DossierObservation => ({
  id: key, lead_id: id, source: 'fmcsa', observed_at: '2026-11-05T09:00:00Z', source_as_of: null,
  match_method: 'agent_selected_dot', snapshot: { dot_number: dot, mcs150_date: date, power_units: units },
});
describe('dossier evidence and internal briefing', () => {
  it('uses only current confirmed business facts and excludes decision-maker details and raw evidence references', () => {
    const findings = {
      ...EMPTY_DOSSIER_FINDINGS,
      business_identity: 'Northside Delivery',
      decision_maker: 'Jane Doe, owner',
      stated_priorities: 'Reliable certificate turnaround',
      next_step: 'Send the vehicle schedule',
    };
    const facts = currentDossierDraftFacts({
      scope_key: `lead:${id}`,
      version: 3,
      findings,
      current_confirmation: {
        scope_key: `lead:${id}`,
        version: 3,
        source_as_of: '2026-11-02',
        reference: 'Private call note with direct contact details',
        findings,
      },
    });
    expect(facts.map((fact) => fact.field)).toEqual(['business_identity', 'stated_priorities', 'next_step']);
    expect(JSON.stringify(facts)).not.toContain('Jane Doe');
    expect(JSON.stringify(facts)).not.toContain('Private call note');
    expect(facts[0]).toMatchObject({ value: 'Northside Delivery', source_as_of: '2026-11-02' });
  });
  it('does not use unconfirmed or stale findings as AI grounding', () => {
    expect(currentDossierDraftFacts({
      scope_key: `lead:${id}`, version: 0, findings: { ...EMPTY_DOSSIER_FINDINGS, stated_priorities: 'unconfirmed' },
      current_confirmation: null,
    })).toEqual([]);
    expect(() => currentDossierDraftFacts({
      scope_key: `lead:${id}`, version: 4, findings: { ...EMPTY_DOSSIER_FINDINGS, stated_priorities: 'Changed' },
      current_confirmation: {
        scope_key: `lead:${id}`, version: 3, source_as_of: '2026-11-02', reference: 'call', findings: { ...EMPTY_DOSSIER_FINDINGS, stated_priorities: 'Old' },
      },
    })).toThrow(/Current dossier confirmation could not be verified/);
  });
  it.each([{ decision_maker: 123 }, { renewal_date: '2027-02-30', renewal_line: 'GL' },
    { renewal_date: '2027-04-22' }, { consent: true }, { next_step: 'x'.repeat(1001) }])('rejects invalid findings %j', (value) => {
    expect(() => parseDossierFindings(value)).toThrow();
  });
  it('rejects object prototype names as unsupported findings', () => {
    expect(() => parseDossierFindings({ toString: 'Unsupported finding' })).toThrow();
  });
  it('does not equate first observation, different entity or same reporting date with growth', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(dossierBriefing(dossier([observation('new', '2026-10-01', 12)]), now).signals).toEqual([]);
    expect(dossierBriefing(dossier([observation('new', '2026-10-01', 12), observation('old', '2026-10-01', 10)]), now).signals).toEqual([]);
    expect(dossierBriefing(dossier([observation('new', '2026-10-01', 12), observation('old', '2026-09-01', 10, '456')]), now).signals).toEqual([]);
  });
  it('preserves numeric differences and cites both observations as needing verification', () => {
    const result = dossierBriefing(dossier([observation('new', '2026-10-01', 12), observation('old', '2026-09-01', 0)]), new Date('2026-11-05T12:00:00Z'));
    expect(result.signals).toEqual([expect.objectContaining({ classification: 'needs_verification', evidence_ids: ['old', 'new'], detail: expect.stringContaining('0 to 12') })]);
    expect(result.signals[0].detail).toContain('correction or reporting lag');
  });
  it('suppresses stale source reports and invalid reporting dates', () => {
    expect(dossierBriefing(dossier([observation('new', '2023-10-01', 12), observation('old', '2023-09-01', 10)]), new Date('2026-11-05T12:00:00Z')).signals).toEqual([]);
    expect(dossierBriefing(dossier([observation('new', 'invalid', 12), observation('old', '2026-09-01', 10)]), new Date('2026-11-05T12:00:00Z')).signals).toEqual([]);
  });
  it('requires an actual DOT identity before comparing fleet counts', () => {
    const newest = observation('new', '2026-10-01', 12);
    const older = observation('old', '2026-09-01', 10);
    delete newest.snapshot.dot_number;
    delete older.snapshot.dot_number;
    expect(dossierBriefing(dossier([newest, older]), new Date('2026-11-05T12:00:00Z')).signals).toEqual([]);
  });
  it.each(['invalid', '2026-11-06T09:00:00Z', '2025-11-05T09:00:00Z'])('suppresses renewal snapshots captured at %s', (observed_at) => {
    const snapshot = { renewals: [{ type: 'General Liability', date: '2027-01-22', evidence_class: 'predicted' }] };
    const source = { ...observation('source', '2026-10-01', 12), observed_at, source: 'Vendor file', snapshot };
    expect(dossierBriefing(dossier([source]), new Date('2026-11-05T12:00:00Z')).signals).toEqual([]);
  });
  it('never renders predictions as confirmed exact dates and keeps appetite as a missing answer', () => {
    const snapshot = { renewals: [{ type: 'General Liability', date: '2027-01-22', evidence_class: 'predicted' }] };
    const result = dossierBriefing(dossier([{ ...observation('source', '2026-10-01', 12), source: 'Vendor file', snapshot }]), new Date('2026-11-05T12:00:00Z'));
    expect(result.signals[0].detail).toContain('Predicted month: 2027-01');
    expect(result.signals[0].detail).not.toContain('2027-01-22');
    expect(result.missing).toContain('Current agency appetite and appointment/access verification');
  });
  it('suppresses conflicting vendor renewal timing only when a current confirmed dossier fact exists', () => {
    const confirmedFindings = {
      ...EMPTY_DOSSIER_FINDINGS,
      renewal_line: 'General Liability',
      renewal_date: '2027-02-15',
    };
    const current = dossier([{
      ...observation('vendor-renewal', '2026-10-01', 12),
      source: 'Vendor file',
      snapshot: { renewals: [
        { type: 'General Liability', date: '2027-01-01', evidence_class: 'predicted', precision: 'month' },
        { type: 'Commercial Auto', date: '2027-02-01', evidence_class: 'predicted', precision: 'month' },
      ] },
    }]);
    current.version = 2;
    current.findings = confirmedFindings;
    current.current_confirmation = {
      id: 'confirmation',
      scope_key: current.scope_key,
      version: 2,
      actor_id: 'agent',
      observed_at: '2026-11-05T10:00:00Z',
      source_as_of: '2026-11-04',
      reference: 'Private call note',
      findings: confirmedFindings,
    };
    const result = dossierBriefing(current, new Date('2026-11-05T12:00:00Z'));
    expect(result.signals).toEqual([
      expect.objectContaining({
        title: 'Conflicting reported renewal timing',
        detail: expect.stringContaining('2027-02-15'),
        evidence_ids: ['vendor-renewal'],
      }),
      expect.objectContaining({ detail: expect.stringContaining('Commercial Auto: Predicted month: 2027-02') }),
    ]);
    expect(result.signals.some((signal) => signal.detail.includes('General Liability: Predicted month: 2027-01'))).toBe(false);
  });
});
let calls: Array<Record<string, unknown>>;
let failure: string | null;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; failure = null;
  const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
    fetch: async (url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(failure ? { code: failure, message: failure === '42501' ? 'This dossier is assigned to another agent.' : 'Dossier findings changed. Reload before saving.' }
        : String(url).includes('save_') ? { version: 1, already_saved: false } : dossier()), {
        status: failure === '42501' ? 403 : failure ? 409 : 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
const save = (extra: Record<string, unknown> = {}) => POST(new NextRequest('http://localhost/api/intelligence/dossier', {
  method: 'POST', body: JSON.stringify({ type: 'lead', id, request_id: id, expected_version: 0, scope_key: `lead:${id}`,
    reference: 'Synthetic client statement', source_as_of: '2026-11-01', findings: { next_step: 'Review documents' }, ...extra }),
}));
describe('scoped dossier API', () => {
  it('reads only through actor-authorized canonical scope RPC', async () => {
    expect((await GET(new NextRequest(`http://localhost/api/intelligence/dossier?type=lead&id=${id}`))).status).toBe(200);
    expect(calls).toEqual([{ p_actor: 'actor', p_type: 'lead', p_id: id, p_page: 0 }]);
  });
  it('passes version, evidence reference and authenticated actor to one atomic save', async () => {
    expect((await save({ actor_id: 'other' })).status).toBe(200);
    expect(calls[0]).toMatchObject({ p_actor: 'actor', p_expected: 0, p_request: id, p_findings: { next_step: 'Review documents' } });
  });
  it.each(['PT409', '42501'])('surfaces %s without masking it as saved', async (code) => {
    failure = code;
    expect((await save()).status).toBe(code === 'PT409' ? 409 : 403);
  });
  it.each([{ source_as_of: '2099-01-01' }, { findings: { renewal_date: '2027-02-30', renewal_line: 'GL' } },
    { expected_version: -1 }, { reference: '' }])('rejects invalid save %j before the database', async (input) => {
    expect((await save(input)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
