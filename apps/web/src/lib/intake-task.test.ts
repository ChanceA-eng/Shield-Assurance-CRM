import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { scheduleIntakeTask } from './intake-task';

describe('configured intake scheduling boundary', () => {
  function fixture(result: unknown = true, error = false) {
    const writes: unknown[] = [];
    const paths: string[] = [];
    const db = createClient('https://db.example.invalid', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        paths.push(String(input));
        if (typeof init?.body === 'string') writes.push(JSON.parse(init.body));
        return new Response(JSON.stringify(error ? { message: 'Intake storage unavailable' } : result), {
          status: error ? 400 : 200, headers: { 'Content-Type': 'application/json' },
        });
      } },
    });
    return { db, writes, paths };
  }
  it.each([true, false])('delegates warm=%s to the same locked SQL executor used by imports', async (warm) => {
    const { db, writes, paths } = fixture();
    expect(await scheduleIntakeTask(db, { leadId: 'lead', name: 'Prospect', warm })).toEqual({ created: true });
    expect(writes).toEqual([{ p_lead: 'lead', p_warm: warm }]);
    expect(paths[0]).toContain('/rpc/schedule_lead_intake');
  });
  it('returns no creation for paused automation or an existing near-term task', async () => {
    const { db } = fixture(false);
    expect(await scheduleIntakeTask(db, { leadId: 'lead', name: 'Prospect', warm: false })).toEqual({ created: false });
  });
  it.each([null, {}, 'true'])('does not treat malformed RPC result %s as a successful task creation', async (result) => {
    const { db } = fixture(result);
    expect(await scheduleIntakeTask(db, { leadId: 'lead', name: 'Prospect', warm: false })).toMatchObject({ created: false, error: expect.stringContaining('follow-up setup failed') });
  });
  it('reports database failure rather than successful intake scheduling', async () => {
    const { db } = fixture(false, true);
    expect(await scheduleIntakeTask(db, { leadId: 'lead', name: 'Prospect', warm: false })).toMatchObject({ created: false, error: expect.stringContaining('follow-up setup failed') });
  });
});
