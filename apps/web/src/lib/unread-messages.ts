import type { SupabaseClient } from '@supabase/supabase-js';
import { phoneDigits } from './message-alerts';

export interface UnreadMessageSummary {
  total: number;
  byClient: Record<string, number>;
  byLead: Record<string, number>;
}

interface UnreadRow {
  client_id: string | null;
  metadata: { lead_id?: unknown } | null;
}

export function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Unread inbound messages, counted globally and attributed to accounts and leads. */
export async function loadUnreadMessageSummary(supabase: SupabaseClient): Promise<UnreadMessageSummary> {
  const unreadRes = await supabase
    .from('communication_log')
    .select('client_id,metadata')
    .eq('direction', 'inbound')
    .is('read_at', null)
    .limit(2000);
  if (unreadRes.error) throw new Error(unreadRes.error.message);

  const rows = (unreadRes.data ?? []) as UnreadRow[];
  const summary: UnreadMessageSummary = { total: rows.length, byClient: {}, byLead: {} };
  if (rows.length === 0) return summary;

  const clientIdsNeedingLead = new Set<string>();
  for (const row of rows) {
    const leadId = typeof row.metadata?.lead_id === 'string' ? row.metadata.lead_id : null;
    if (row.client_id) bump(summary.byClient, row.client_id);
    if (leadId) bump(summary.byLead, leadId);
    else if (row.client_id) clientIdsNeedingLead.add(row.client_id);
  }

  if (clientIdsNeedingLead.size === 0) return summary;

  // Older rows only carry client_id: attribute them to the linked (or matching) active lead.
  const ids = [...clientIdsNeedingLead];
  const [clientsRes, leadsRes] = await Promise.all([
    supabase.from('clients').select('id,email,phone').in('id', ids),
    supabase.from('leads').select('id,email,phone,account_id').in('status', ['new', 'contacted', 'quoted']).limit(2000),
  ]);
  if (clientsRes.error || leadsRes.error) return summary;

  const leadByAccount = new Map<string, string>();
  const leadByEmail = new Map<string, string>();
  const leadByPhone = new Map<string, string>();
  for (const lead of leadsRes.data ?? []) {
    if (lead.account_id) leadByAccount.set(String(lead.account_id), lead.id);
    if (lead.email) leadByEmail.set(String(lead.email).toLowerCase(), lead.id);
    const digits = phoneDigits(lead.phone as string | null);
    if (digits) leadByPhone.set(digits, lead.id);
  }

  const unattributed: Record<string, number> = {};
  for (const row of rows) {
    const hasLead = typeof row.metadata?.lead_id === 'string';
    if (!hasLead && row.client_id) bump(unattributed, row.client_id);
  }

  for (const client of clientsRes.data ?? []) {
    const count = unattributed[client.id] ?? 0;
    if (count === 0) continue;
    const email = client.email ? String(client.email).toLowerCase() : '';
    const digits = phoneDigits(client.phone as string | null);
    const leadId = leadByAccount.get(client.id) || (email && leadByEmail.get(email)) || (digits && leadByPhone.get(digits)) || null;
    if (leadId) bump(summary.byLead, leadId, count);
  }

  return summary;
}
