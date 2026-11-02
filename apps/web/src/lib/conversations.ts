/**
 * Canonical conversation identity shared by the unified inbox, account and lead
 * workspaces. Every communication_log row maps to exactly one key, so lead-only
 * and unmatched messages are never dropped from the inbox.
 *
 *   client:<account uuid>   messages on an account (or from a lead linked to one)
 *   lead:<lead uuid>        messages from/to a lead with no linked account
 *   unmatched:<address>     inbound/outbound messages with no known contact
 */

export type ConversationKind = 'client' | 'lead' | 'unmatched';

export interface ConversationRef {
  kind: ConversationKind;
  id: string;
}

export interface ConversationLogRow {
  id: string;
  client_id: string | null;
  direction: string | null;
  metadata?: Record<string, unknown> | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UNKNOWN_ADDRESS = 'unknown';

function metadataOf(row: Pick<ConversationLogRow, 'metadata'>): Record<string, unknown> {
  const value = row.metadata;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Emails compare case-insensitively; phone numbers compare by their 10-digit national number. */
export function normalizeAddress(value: unknown): string {
  const raw = stringField(value);
  if (!raw) return '';
  const angle = /<([^>]+@[^>]+)>/.exec(raw);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  if (candidate.includes('@')) return candidate;
  const digits = candidate.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length >= 7 ? digits : '';
}

export function rowLeadId(row: Pick<ConversationLogRow, 'metadata'>): string | null {
  const leadId = stringField(metadataOf(row).lead_id);
  return UUID_PATTERN.test(leadId) ? leadId : null;
}

/** The counterpart address: who sent an inbound message, or who an outbound one went to. */
export function rowCounterpartAddress(row: ConversationLogRow): string {
  const metadata = metadataOf(row);
  const inbound = row.direction === 'inbound';
  return normalizeAddress(inbound ? metadata.from : metadata.to) || normalizeAddress(inbound ? metadata.to : metadata.from);
}

export function formatConversationKey(ref: ConversationRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseConversationKey(value: unknown): ConversationRef | null {
  const raw = stringField(value);
  const separator = raw.indexOf(':');
  if (separator < 0) return null;
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if ((kind === 'client' || kind === 'lead') && UUID_PATTERN.test(id)) return { kind, id: id.toLowerCase() };
  if (kind === 'unmatched') {
    if (id === UNKNOWN_ADDRESS) return { kind, id };
    const address = normalizeAddress(id);
    return address ? { kind, id: address } : null;
  }
  return null;
}

/**
 * @param leadAccounts lead id -> linked account id (or null). Messages from a lead that has
 * since been linked to an account belong to the account conversation.
 */
export function conversationRefForRow(row: ConversationLogRow, leadAccounts?: ReadonlyMap<string, string | null>): ConversationRef {
  if (row.client_id) return { kind: 'client', id: row.client_id.toLowerCase() };
  const leadId = rowLeadId(row);
  if (leadId) {
    const accountId = leadAccounts?.get(leadId) ?? null;
    return accountId ? { kind: 'client', id: accountId.toLowerCase() } : { kind: 'lead', id: leadId.toLowerCase() };
  }
  return { kind: 'unmatched', id: rowCounterpartAddress(row) || UNKNOWN_ADDRESS };
}

export function conversationKeyForRow(row: ConversationLogRow, leadAccounts?: ReadonlyMap<string, string | null>): string {
  return formatConversationKey(conversationRefForRow(row, leadAccounts));
}

/** Deep link that opens the conversation where it is actually rendered. */
export function conversationHref(ref: ConversationRef): string {
  if (ref.kind === 'client') return `/clients/${encodeURIComponent(ref.id)}?tab=communication`;
  if (ref.kind === 'lead') return `/leads?lead=${encodeURIComponent(ref.id)}&tab=conversation`;
  return `/communication?conversation=${encodeURIComponent(formatConversationKey(ref))}`;
}

export function isUnreadInbound(row: { direction: string | null; read_at?: string | null }): boolean {
  return row.direction === 'inbound' && !row.read_at;
}

/** Ids to mark read after a thread was successfully loaded and shown. */
export function unreadInboundIds(rows: Array<{ id: string; direction: string | null; read_at?: string | null }>): string[] {
  return rows.filter(isUnreadInbound).map((row) => row.id);
}
