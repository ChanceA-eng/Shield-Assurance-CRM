import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { interpretCarrierGuide, readAppetiteWithAI } from './carrier-appetite-ai';

const pages = [{ page: 1, text: 'COMMERCIAL AUTO\nEligible fleets: 11+ power units.\nCONTACT US\n800-555-0100' }];
const bytes = Buffer.from('%PDF-1.4 synthetic public fixture');
const reading = () => ({
  carrier: 'Synthetic Carrier', line: 'commercial auto', states: 'AZ', summary: 'Commercial auto for fleets of at least 11 power units.',
  rules: [{ criterion: 'Fleet has at least 11 power units', decision: 'eligible', page: 1, excerpt: 'Eligible fleets: 11+ power units.',
    predicate: { field: 'power_units', operator: 'gte', value: '11' } }], unresolved_entries: [],
});
let db: SupabaseClient;
let cached: { state: string; reading?: unknown; updated_at: string } | null;
let completeFailure: boolean;
beforeEach(() => {
  cached = null; completeFailure = false;
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-key');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reading()) }] }],
  })));
  db = createClient('https://synthetic.invalid', 'synthetic', { auth: { persistSession: false }, global: {
    fetch: async (_input, init) => {
      if (init?.method === 'POST') {
        if (cached) return Response.json({ code: '23505', message: 'Duplicate reading' }, { status: 409 });
        cached = { ...JSON.parse(String(init.body)), updated_at: new Date().toISOString() };
        return new Response(null, { status: 201 });
      }
      if (init?.method === 'PATCH') {
        const change = JSON.parse(String(init.body));
        if (completeFailure && change.state === 'complete') return Response.json({ code: 'synthetic', message: 'Save failed' }, { status: 503 });
        cached = { ...cached!, ...change };
        return init.headers && new Headers(init.headers).get('Prefer')?.includes('return=representation')
          ? Response.json([{ source_hash: 'synthetic' }]) : new Response(null, { status: 204 });
      }
      return Response.json(cached);
    },
  } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('reads the original PDF once, stores cited comparisons and reuses the result across uploads', async () => {
  const first = await interpretCarrierGuide(db, bytes, 'application/pdf', pages);
  expect(first).toMatchObject({ line: 'commercial auto', interpretation: { summary: reading().summary }, rules: [{ predicate: { field: 'power_units', value: '11' } }] });
  expect(first.rules).toHaveLength(1);
  expect(await interpretCarrierGuide(db, bytes, 'application/pdf', pages)).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(request.store).toBe(false);
  expect(request.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_file', file_data: expect.stringContaining('data:application/pdf;base64,') }));
  expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true });
});
it('does not start duplicate concurrent reads and explicitly recovers abandoned requests only on retry', async () => {
  cached = { state: 'processing', updated_at: new Date().toISOString() };
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages, true)).rejects.toThrow('already being read');
  expect(fetch).not.toHaveBeenCalled();
  cached.updated_at = '2020-01-01T00:00:00Z';
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages)).rejects.toThrow('already being read');
  await interpretCarrierGuide(db, bytes, 'application/pdf', pages, true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('reports missing keys and exhausted credits without silently replacing AI with line parsing or repeated charges', async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages)).rejects.toThrow('OPENAI_API_KEY');
  expect(cached?.state).toBe('failed');
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv('OPENAI_API_KEY', 'synthetic');
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages)).rejects.toThrow('previous AI reading failed');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 429 }));
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages, true)).rejects.toThrow('credit limit');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects incomplete output and invalid numeric comparisons, retaining uncitable criteria only as warnings', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'incomplete', output: [] }));
  await expect(readAppetiteWithAI(bytes, 'application/pdf', pages)).rejects.toThrow('incomplete');
  const invalid = reading(); invalid.rules[0].predicate.value = 'eleven';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(invalid) }] }] }));
  await expect(interpretCarrierGuide(db, bytes, 'application/pdf', pages)).rejects.toThrow('nonnegative number');
  const uncited = reading(); uncited.rules[0].excerpt = 'Unverifiable eligibility';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(uncited) }] }] }));
  const saved = await interpretCarrierGuide(db, bytes, 'application/pdf', pages, true);
  expect(saved.rules).toEqual([]);
  expect(saved.unresolved_entries).toHaveLength(1);
});
