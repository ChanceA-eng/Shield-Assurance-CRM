import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { PATCH } from '../app/api/import/[batchId]/route';
import { getSupabaseServerClient } from './supabase-server';
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ getApiSession: vi.fn().mockResolvedValue({ user: { id: 'actor' }, error: null }) }));
let size: number;
let fail: boolean;
let updates: Array<{ url: URL; body: Record<string, unknown> }>;
beforeEach(() => {
  vi.clearAllMocks(); size = 1; fail = false; updates = [];
  const db = createClient('https://example.invalid', 'test', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const isUpdate = init?.method === 'PATCH';
      if (isUpdate) updates.push({ url, body: JSON.parse(String(init.body)) });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const data = url.pathname.endsWith('/import_batches') ? { vendor_profile: 'commercial' }
        : isUpdate ? fail ? { code: 'XX000', message: 'Save failed' } : [{ id: 'synthetic' }]
          : Array.from({ length: Math.max(0, Math.min(500, size - offset)) }, (_, index) => ({
            id: `synthetic-${offset + index}`, disposition: 'pending', payload: {
              raw: [{ 'Prospect Name': 'Synthetic', 'Contact Email': 'source@example.invalid' }],
            },
          }));
      return new Response(JSON.stringify(data), { status: isUpdate && fail ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
});
const reparse = () => PATCH(new NextRequest('http://localhost/api/import/batch', { method: 'PATCH', body: '{"action":"reparse"}' }),
  { params: Promise.resolve({ batchId: 'batch' }) });
describe('complete and conflict-safe staging reparse', () => {
  it('reparses beyond the old 2000-row cap without resetting manual contact edits', async () => {
    size = 2101;
    expect(await (await reparse()).json()).toMatchObject({ ok: true, reparsed: 2101, errors: [] });
    expect(updates).toHaveLength(2101);
    expect(updates[0].body).not.toHaveProperty('email');
    expect(updates[0].url.searchParams.get('disposition')).toBe('neq.committed');
    expect(updates[0].url.searchParams.get('payload')).toContain('eq.');
  });
  it('reports partial reparse failure explicitly', async () => {
    fail = true;
    const result = await reparse();
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ ok: false, reparsed: 0, errors: [expect.any(String)] });
  });
});
