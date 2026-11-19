import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';

export async function websiteSubmissionReceipts(
  db: SupabaseClient, payloads: Record<string, unknown>[],
): Promise<Map<number, string | null>> {
  const receipts = new Map<number, string | null>();
  for (let offset = 0; offset < payloads.length; offset += 100) {
    const { data, error } = await db.rpc('website_submission_receipts_for', { p_payloads: payloads.slice(offset, offset + 100) });
    if (error) throw databaseError(error);
    if (!Array.isArray(data)) throw new Error('Website submission lookup returned an invalid result.');
    for (const row of data) {
      if (!Number.isInteger(row.position) || row.position < 0 || row.position >= Math.min(100, payloads.length - offset)
        || (row.lead_id !== null && typeof row.lead_id !== 'string')) throw new Error('Website submission lookup returned an invalid receipt.');
      receipts.set(offset + row.position, row.lead_id);
    }
  }
  return receipts;
}
