import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from './workspace-fixtures';

test('processed website submissions cannot restore archived or recreate purged leads', async ({ context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url || !key || !databaseUrl) throw new Error('Configured Supabase and direct database access are required for disposable replay QA.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const id = randomUUID();
  const sourceId = `crm-browser-replay-${randomUUID()}`;
  const payload = { id: sourceId, full_name: 'Website replay QA', email: `${sourceId}@example.invalid`, submitted_at: '2020-01-01T10:00:00Z' };
  try {
    const inserted = await admin.from('leads').insert({ id, full_name: payload.full_name, email: payload.email, source: 'website', status: 'new', form_payload: payload });
    if (inserted.error) throw new Error(inserted.error.message);
    const queue = await context.request.get('/api/leads/attention');
    expect(queue.status()).toBe(200);
    expect((await queue.json() as { leads: Array<{ id: string }> }).leads.some((lead) => lead.id === id)).toBe(true);
    const archived = await admin.rpc('archive_leads', { p_ids: [id], p_actor: 'Disposable replay QA' });
    if (archived.error) throw new Error(archived.error.message);
    const duplicate = await context.request.post('/api/leads', { data: payload });
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toEqual({ id, duplicate: true });
    const preserved = await admin.from('leads').select('archived_at').eq('id', id).single();
    if (preserved.error) throw new Error(preserved.error.message);
    expect(preserved.data.archived_at).not.toBeNull();
    const purged = await admin.rpc('purge_leads', { p_ids: [id], p_actor: 'Disposable replay QA' });
    if (purged.error) throw new Error(purged.error.message);
    for (let attempt = 0; attempt < 2; attempt++) {
      const replay = await context.request.post('/api/leads', { data: payload });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual({ id: null, duplicate: true });
    }
    const missing = await admin.from('leads').select('id').eq('email', payload.email);
    if (missing.error) throw new Error(missing.error.message);
    expect(missing.data).toEqual([]);
    const finalQueue = await context.request.get('/api/leads/attention');
    expect(finalQueue.status()).toBe(200);
    expect((await finalQueue.json() as { leads: Array<{ id: string }> }).leads.some((lead) => lead.id === id)).toBe(false);
  } finally {
    try {
      const archived = await admin.rpc('archive_leads', { p_ids: [id], p_actor: 'Disposable replay QA cleanup' });
      if (archived.error) throw new Error(archived.error.message);
      const purged = await admin.rpc('purge_leads', { p_ids: [id], p_actor: 'Disposable replay QA cleanup' });
      if (purged.error) throw new Error(purged.error.message);
      await db.$executeRaw`delete from public.website_submission_receipts where submission_key=${`website:${sourceId}`} and lead_id is null`;
    } finally { await db.$disconnect(); }
  }
});
