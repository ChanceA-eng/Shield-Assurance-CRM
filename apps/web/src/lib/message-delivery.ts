import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress, parseConversationKey } from './conversations';

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
  const { data, error } = await supabase.from('outreach_opt_outs').select('email').eq('email', normalized).limit(1);
  if (error) return { ok: false, status: 500, code: 'consent_check_failed', message: `Could not verify email opt-outs: ${error.message}` };
  return { ok: true, optedOut: (data ?? []).length > 0 };
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
