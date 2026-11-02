import type { SupabaseClient } from '@supabase/supabase-js';

export interface UnreadMessageSummary {
  total: number;
  byClient: Record<string, number>;
  byLead: Record<string, number>;
}

export function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export async function loadUnreadMessageSummary(supabase: SupabaseClient): Promise<UnreadMessageSummary> {
  const result = await supabase.rpc('unread_message_summary');
  if (result.error) throw new Error(`Unread message counts could not load: ${result.error.message}`);
  const data = result.data as UnreadMessageSummary | null;
  if (!data || !Number.isSafeInteger(data.total) || !data.byClient || !data.byLead) throw new Error('Unread message counts returned an invalid result.');
  return data;
}
