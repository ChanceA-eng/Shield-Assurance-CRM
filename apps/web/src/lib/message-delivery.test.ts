import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { resolveIntakeInvitationRecipient, resolveOutboundEmailRecipient } from './message-delivery';

const leadId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const clientId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const email = 'prospect@example.test';
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function db(doNotContact = false, missingPreferenceTable = false, optedOut = false) {
  const calls: string[] = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const table = url.pathname.split('/').pop() ?? '';
      calls.push(table);
      if (table === 'leads') {
        return url.searchParams.has('account_id') ? json([{ id: leadId }])
          : json({ id: leadId, email, account_id: url.searchParams.get('select')?.includes('account_id') ? clientId : null, form_payload: null });
      }
      if (table === 'clients') return json({ id: clientId, email, email_consent: true, preferred_channel: 'email' });
      if (table === 'record_contact_preferences') {
        if (missingPreferenceTable) return json({ code: 'PGRST205', message: 'table missing' }, 404);
        const linkedLeadLookup = url.searchParams.has('lead_id') && url.searchParams.get('lead_id')?.startsWith('in.');
        return doNotContact && (url.searchParams.has('lead_id') && (linkedLeadLookup || url.searchParams.get('lead_id')?.includes(leadId)))
          ? json([{ do_not_contact: true }]) : json(null);
      }
      if (table === 'outreach_opt_outs' || table === 'email_suppressions') return json(optedOut && table === 'outreach_opt_outs' ? [{ email: 'other@example.test' }] : []);
      return json({ message: `Unexpected table ${table}` }, 500);
    } },
  });
  return { client, calls };
}

describe('record-level Do Not Contact enforcement', () => {
  it('blocks an email to a lead marked Do Not Contact before consent or delivery checks', async () => {
    const { client, calls } = db(true);
    const result = await resolveOutboundEmailRecipient(client, { leadId, to: email });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'do_not_contact' });
    expect(calls).not.toContain('outreach_opt_outs');
  });

  it('blocks an account when a linked lead is marked Do Not Contact', async () => {
    const { client } = db(true);
    const result = await resolveOutboundEmailRecipient(client, { clientId, to: email });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'do_not_contact' });
  });

  it('fails closed when the contact-preference migration has not been applied', async () => {
    const { client } = db(false, true);
    const result = await resolveOutboundEmailRecipient(client, { leadId, to: email });
    expect(result).toMatchObject({ ok: false, status: 503, code: 'contact_preference_unavailable' });
  });
});

describe('Secure Intake invitation recipients', () => {
  it('sends to the request address even when it differs from the lead email', async () => {
    const { client } = db();
    const result = await resolveIntakeInvitationRecipient(client, { to: 'Other@Example.test', leadId, clientId: null });
    expect(result).toEqual({ ok: true, recipient: { to: 'other@example.test', leadId, clientId } });
  });

  it('still blocks Do Not Contact records and opted-out addresses', async () => {
    expect(await resolveIntakeInvitationRecipient(db(true).client, { to: 'other@example.test', leadId, clientId: null }))
      .toMatchObject({ ok: false, code: 'do_not_contact' });
    expect(await resolveIntakeInvitationRecipient(db(false, false, true).client, { to: 'other@example.test', leadId, clientId: null }))
      .toMatchObject({ ok: false, code: 'opted_out' });
  });
});
