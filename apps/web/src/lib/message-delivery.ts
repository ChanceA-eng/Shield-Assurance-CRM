import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress, parseConversationKey } from './conversations';
import { databaseError } from './workspace-api';

/**
 * Truthful outbound messaging rules shared by every manual send path.
 * - SMS: the CRM only has an inbound Twilio webhook; there is no send adapter, so
 *   outbound texts are rejected instead of being logged as if they were sent.
 * - Email: consent and opt-out are checked on the server before handing off to the
 *   provider, and the recorded status is "accepted by provider", never "delivered".
 */

export const SMS_UNAVAILABLE = {
  status: 422,
  code: 'sms_unavailable',
  message: 'Text messaging is not connected: the CRM has no SMS sending provider, so texts cannot be sent from here. Email the contact or call them instead.',
} as const;

export type DeliveryStatus = 'accepted_by_provider';

export type ConsentDecision = { allowed: true } | { allowed: false; code: string; message: string };

export interface AccountConsentFields {
  email: string | null;
  email_consent?: boolean | null;
  preferred_channel?: string | null;
}

export interface LeadConsentFields {
  email: string | null;
  form_payload?: unknown;
}

const CONTACT_PREFERENCE_MIGRATION = '20261113015000_record_contact_preferences';

export async function leadContactRestrictions(db: SupabaseClient, ids: string[]): Promise<Map<string, boolean>> {
  const result = await db.rpc('lead_contact_restrictions', { p_leads: ids });
  if (result.error) throw databaseError(result.error);
  const rows: unknown = result.data;
  if (!Array.isArray(rows)) throw new Error('Contact restrictions returned an invalid result.');
  const restrictions = new Map<string, boolean>();
  for (const row of rows) {
    if (isRecord(row) && typeof row.lead_id === 'string' && typeof row.do_not_contact === 'boolean') {
      restrictions.set(row.lead_id, row.do_not_contact);
    } else throw new Error('Contact restrictions returned an invalid result.');
  }
  if (ids.some((id) => !restrictions.has(id))) throw new Error('Contact restrictions are incomplete.');
  return restrictions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** True when the website intake explicitly recorded that the lead declined contact. */
export function leadDeclinedContact(formPayload: unknown): boolean {
  if (!isRecord(formPayload)) return false;
  const metadata = isRecord(formPayload.metadata) ? formPayload.metadata : {};
  const consent = isRecord(metadata.contactConsent) ? metadata.contactConsent : null;
  return Boolean(consent && consent.accepted === false);
}

const OPTED_OUT: ConsentDecision = {
  allowed: false,
  code: 'opted_out',
  message: 'This address unsubscribed from Shield Assurance email. Remove the opt-out before emailing them.',
};

export function accountEmailConsent(account: AccountConsentFields, optedOut: boolean): ConsentDecision {
  if (optedOut) return OPTED_OUT;
  const channel = (account.preferred_channel ?? '').trim().toLowerCase();
  if (account.email_consent === true || channel === 'email' || channel === 'both') return { allowed: true };
  return {
    allowed: false,
    code: 'no_email_consent',
    message: 'This account has not consented to email. Record email consent on the account before sending.',
  };
}

export function leadEmailConsent(lead: LeadConsentFields, optedOut: boolean): ConsentDecision {
  if (optedOut) return OPTED_OUT;
  if (leadDeclinedContact(lead.form_payload)) {
    return { allowed: false, code: 'contact_declined', message: 'This lead declined to be contacted on their intake form.' };
  }
  return { allowed: true };
}

export type Checked<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };

/** Opt-out lookup that fails closed: a query error blocks the send instead of ignoring the list. */
export async function checkEmailOptOut(supabase: SupabaseClient, email: string): Promise<Checked<{ optedOut: boolean }>> {
  const normalized = email.trim().toLowerCase();
  const [optOuts, suppressions] = await Promise.all([
    supabase.from('outreach_opt_outs').select('email').eq('email', normalized).limit(1),
    supabase.from('email_suppressions').select('email').eq('email', normalized).limit(1),
  ]);
  const error = optOuts.error ?? suppressions.error;
  if (error) return { ok: false, status: 500, code: 'consent_check_failed', message: `Could not verify email opt-outs: ${error.message}` };
  return { ok: true, optedOut: Boolean(optOuts.data?.length || suppressions.data?.length) };
}

export interface OutboundTarget {
  clientId?: string | null;
  leadId?: string | null;
  conversationKey?: string | null;
  to?: string | null;
}

export interface ResolvedRecipient {
  to: string;
  clientId: string | null;
  leadId: string | null;
}

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function blocked(decision: Exclude<ConsentDecision, { allowed: true }>): { ok: false; status: number; code: string; message: string } {
  return { ok: false, status: 403, code: decision.code, message: decision.message };
}

async function checkRecordContactPreference(
  supabase: SupabaseClient,
  leadId: string | null,
  clientId: string | null,
): Promise<Checked<{}>> {
  const [lead, client, linkedLeads] = await Promise.all([
    leadId ? supabase.from('record_contact_preferences').select('do_not_contact').eq('lead_id', leadId).maybeSingle<{ do_not_contact: boolean }>()
      : Promise.resolve({ data: null, error: null }),
    clientId ? supabase.from('record_contact_preferences').select('do_not_contact').eq('client_id', clientId).maybeSingle<{ do_not_contact: boolean }>()
      : Promise.resolve({ data: null, error: null }),
    clientId ? supabase.from('leads').select('id').eq('account_id', clientId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = lead.error ?? client.error ?? linkedLeads.error;
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204') {
      console.error('[contact-preference/schema]', CONTACT_PREFERENCE_MIGRATION, error.code, error.message);
      return { ok: false, status: 503, code: 'contact_preference_unavailable',
        message: 'Contact preferences are temporarily unavailable. Please try again before sending.' };
    }
    console.error('[contact-preference/check]', error.code, error.message);
    return { ok: false, status: 500, code: 'contact_preference_check_failed', message: 'Contact preferences could not be checked. Please try again before sending.' };
  }
  const linkedLeadIds = [...new Set((linkedLeads.data ?? []).map((row) => row.id).filter((id) => id !== leadId))];
  if (linkedLeadIds.length) {
    const linked = await supabase.from('record_contact_preferences').select('do_not_contact').in('lead_id', linkedLeadIds);
    if (linked.error) return { ok: false, status: 500, code: 'contact_preference_check_failed',
      message: `Could not verify linked-record contact restrictions: ${linked.error.message}` };
    if (linked.data?.some((row) => row.do_not_contact)) {
      return blocked({ allowed: false, code: 'do_not_contact', message: 'A linked lead is marked Do Not Contact. Clear that restriction before emailing this account.' });
    }
  }
  if (lead.data?.do_not_contact || client.data?.do_not_contact) {
    return blocked({ allowed: false, code: 'do_not_contact', message: 'This record is marked Do Not Contact. Clear the restriction before emailing.' });
  }
  return { ok: true };
}

/**
 * Secure Intake invitations go to the address the agent entered on the request, which may differ
 * from the record's email. Record restrictions and opt-outs for that address still apply.
 */
export async function resolveIntakeInvitationRecipient(
  supabase: SupabaseClient,
  target: { to: string; leadId: string | null; clientId: string | null },
): Promise<Checked<{ recipient: ResolvedRecipient }>> {
  const to = normalizeAddress(target.to);
  if (!to || !EMAIL_PATTERN.test(to)) return { ok: false, status: 400, code: 'invalid_recipient', message: 'Enter a valid recipient email address.' };
  let clientId = target.clientId;
  if (target.leadId) {
    const { data: lead, error } = await supabase.from('leads').select('id,account_id,form_payload').eq('id', target.leadId)
      .maybeSingle<{ id: string; account_id: string | null; form_payload: unknown }>();
    if (error) return { ok: false, status: 500, code: 'lookup_failed', message: error.message };
    if (!lead) return { ok: false, status: 404, code: 'not_found', message: 'Lead not found.' };
    if (leadDeclinedContact(lead.form_payload)) {
      return blocked({ allowed: false, code: 'contact_declined', message: 'This lead declined to be contacted on their intake form.' });
    }
    clientId = clientId ?? lead.account_id;
  }
  if (target.leadId || clientId) {
    const preference = await checkRecordContactPreference(supabase, target.leadId, clientId);
    if (!preference.ok) return preference;
  }
  const optOut = await checkEmailOptOut(supabase, to);
  if (!optOut.ok) return optOut;
  if (optOut.optedOut) return blocked(OPTED_OUT as Exclude<ConsentDecision, { allowed: true }>);
  return { ok: true, recipient: { to, clientId, leadId: target.leadId } };
}

/**
 * Resolves who an outbound email goes to and enforces consent. A supplied `to` must match the
 * record's email; lead-only sends stay on the lead (no account is created implicitly).
 */
export async function resolveOutboundEmailRecipient(supabase: SupabaseClient, target: OutboundTarget): Promise<Checked<{ recipient: ResolvedRecipient }>> {
  let clientId = target.clientId?.trim() || null;
  let leadId = target.leadId?.trim() || null;
  let to = normalizeAddress(target.to);
  if (target.to && !to) return { ok: false, status: 400, code: 'invalid_recipient', message: 'Enter a valid recipient email address.' };

  const ref = target.conversationKey ? parseConversationKey(target.conversationKey) : null;
  if (target.conversationKey && !ref) return { ok: false, status: 400, code: 'invalid_conversation', message: 'Unknown conversation.' };
  if (ref?.kind === 'client') clientId = clientId ?? ref.id;
  if (ref?.kind === 'lead') leadId = leadId ?? ref.id;
  if (ref?.kind === 'unmatched') {
    if (!ref.id.includes('@')) return { ok: false, status: 422, code: 'no_email_address', message: 'This conversation has no email address to reply to.' };
    if (to && to !== ref.id) return { ok: false, status: 400, code: 'recipient_mismatch', message: 'The recipient does not match this conversation.' };
    to = ref.id;
  }

  if (leadId) {
    const { data: lead, error } = await supabase.from('leads').select('id,email,account_id,form_payload').eq('id', leadId).maybeSingle<{
      id: string; email: string | null; account_id: string | null; form_payload: unknown;
    }>();
    if (error) return { ok: false, status: 500, code: 'lookup_failed', message: error.message };
    if (!lead) return { ok: false, status: 404, code: 'not_found', message: 'Lead not found.' };
    const preference = await checkRecordContactPreference(supabase, lead.id, lead.account_id);
    if (!preference.ok) return preference;
    const leadEmail = normalizeAddress(lead.email);
    if (!clientId) {
      if (!leadEmail) return { ok: false, status: 422, code: 'no_email_address', message: 'Add an email address to this lead before emailing them.' };
      if (to && to !== leadEmail) return { ok: false, status: 400, code: 'recipient_mismatch', message: 'The recipient does not match the lead email.' };
      const optOut = await checkEmailOptOut(supabase, leadEmail);
      if (!optOut.ok) return optOut;
      const decision = leadEmailConsent(lead, optOut.optedOut);
      if (!decision.allowed) return blocked(decision);
      return { ok: true, recipient: { to: leadEmail, clientId: lead.account_id, leadId: lead.id } };
    }
    if (lead.account_id && lead.account_id !== clientId) {
      return { ok: false, status: 400, code: 'record_mismatch', message: 'This lead is linked to a different account.' };
    }
    if (leadDeclinedContact(lead.form_payload)) {
      return blocked({ allowed: false, code: 'contact_declined', message: 'This lead declined to be contacted on their intake form.' });
    }
  }

  if (clientId) {
    const { data: account, error } = await supabase
      .from('clients')
      .select('id,email,email_consent,preferred_channel')
      .eq('id', clientId)
      .maybeSingle<{ id: string } & AccountConsentFields>();
    if (error) return { ok: false, status: 500, code: 'lookup_failed', message: error.message };
    if (!account) return { ok: false, status: 404, code: 'not_found', message: 'Account not found.' };
    const preference = await checkRecordContactPreference(supabase, null, account.id);
    if (!preference.ok) return preference;
    const accountEmail = normalizeAddress(account.email);
    if (!accountEmail) return { ok: false, status: 422, code: 'no_email_address', message: 'Add an email address to this account before emailing them.' };
    if (to && to !== accountEmail) return { ok: false, status: 400, code: 'recipient_mismatch', message: 'The recipient does not match the account email.' };
    const optOut = await checkEmailOptOut(supabase, accountEmail);
    if (!optOut.ok) return optOut;
    const decision = accountEmailConsent(account, optOut.optedOut);
    if (!decision.allowed) return blocked(decision);
    return { ok: true, recipient: { to: accountEmail, clientId: account.id, leadId } };
  }

  if (!to || !EMAIL_PATTERN.test(to)) {
    return { ok: false, status: 400, code: 'recipient_required', message: 'Choose an account, lead or conversation to email.' };
  }
  const optOut = await checkEmailOptOut(supabase, to);
  if (!optOut.ok) return optOut;
  if (optOut.optedOut) return blocked(OPTED_OUT as Exclude<ConsentDecision, { allowed: true }>);
  return { ok: true, recipient: { to, clientId: null, leadId: null } };
}
