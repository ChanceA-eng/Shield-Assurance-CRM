import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from './workspace-fixtures';
import { isUuid } from '../src/lib/workspace-validation';

test('real manual intake, linked account, vehicle and quote survive reload without binding coverage', async ({ context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured Supabase is required for disposable persistence QA.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `crm-intake-qa-${randomUUID()}@example.invalid`;
  let account: string | null = null;
  const quoteId = randomUUID();
  try {
    const intake = { kind: 'personal', source: 'referral',
      contact: { first_name: 'Disposable', last_name: 'Intake QA', phone: '(520) 555-0199', email, preferred_contact: '', street: '', city: '', state: 'AZ', zip: '' },
      dob: '', marital_status: '', occupation: '', prior_limits: '', umbrella_limit: '', coverages: ['auto'],
      current: { carrier: '', expiration: '', premium: '' }, drivers: [],
      vehicles: [{ year: '2024', make: 'HONDA', model: 'Civic', vin: '', use: '', ownership: '', vehicle_type: '' }], properties: [], notes: 'Disposable persistence verification.',
    };
    const created = await context.request.post('/api/leads/intake', { data: { intake, allow_duplicate: true } });
    expect(created.status()).toBe(201);
    const result = await created.json() as { id: string };
    expect(isUuid(result.id)).toBe(true);
    const saved = await admin.from('leads').select('id,form_payload,status').eq('id', result.id).single();
    if (saved.error) throw saved.error;
    expect(saved.data.form_payload.agent_intake.answers.vehicles[0]).toMatchObject({ year: '2024', make: 'HONDA', model: 'Civic' });
    const assets = await context.request.get(`/api/record-assets?record_type=lead&record_id=${result.id}`);
    expect(assets.status()).toBe(200);
    expect(await assets.json()).toEqual(expect.arrayContaining([expect.objectContaining({ asset_type: 'vehicle', metadata: expect.objectContaining({
      details: expect.objectContaining({ year: '2024', make: 'HONDA', model: 'Civic' }),
    }) })]));
    const duplicate = await context.request.post('/api/leads/intake', { data: { intake } });
    expect(duplicate.status()).toBe(409);
    const linked = await context.request.post(`/api/leads/${result.id}/workspace`, { data: { create: true } });
    expect(linked.status()).toBe(200);
    account = (await linked.json() as { clientId: string }).clientId;
    expect(isUuid(account)).toBe(true);
    const endpoint = `/api/quote-options?record_type=lead&record_id=${result.id}`;
    const quote = { id: quoteId, carrier: 'Disposable QA Carrier', line_of_business: 'Personal Auto', premium: '1234.56',
      status: 'accepted', limits: 'QA only', deductibles: '', notes: 'Not a carrier quote or binding instruction.' };
    expect((await context.request.post(endpoint, { data: quote })).status()).toBe(201);
    expect((await context.request.post(endpoint, { data: quote })).status()).toBe(200);
    const reloaded = await context.request.get(endpoint);
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toEqual([expect.objectContaining({ id: quoteId, premium: 1234.56, status: 'accepted' })]);
    const policies = await admin.from('policies').select('id').eq('client_id', account);
    if (policies.error) throw policies.error;
    expect(policies.data).toEqual([]);
  } finally {
    const leads = await admin.from('leads').select('id').eq('email', email);
    if (leads.error) throw leads.error;
    for (const row of leads.data) {
      const archived = await admin.rpc('archive_leads', { p_ids: [row.id], p_actor: 'Disposable intake QA cleanup' });
      if (archived.error) throw archived.error;
      const purged = await admin.rpc('purge_leads', { p_ids: [row.id], p_actor: 'Disposable intake QA cleanup' });
      if (purged.error) throw purged.error;
    }
    const removedHistory = await admin.from('quote_option_history').delete().eq('quote_id', quoteId);
    if (removedHistory.error) throw removedHistory.error;
    const removedQuote = await admin.from('quote_options').delete().eq('id', quoteId);
    if (removedQuote.error) throw removedQuote.error;
    if (account) {
      const removedAccount = await admin.from('clients').delete().eq('id', account);
      if (removedAccount.error) throw removedAccount.error;
    }
  }
});

test('authenticated vehicle catalog returns real Honda models without sending customer VINs', async ({ context }) => {
  const result = await context.request.get('/api/vehicles?type=car&year=2024&make=474');
  expect(result.status()).toBe(200);
  expect(await result.json()).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ name: 'Civic' }), expect.objectContaining({ name: 'Accord' })]) });
});
