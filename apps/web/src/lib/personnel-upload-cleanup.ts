import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';

export async function cleanExpiredPersonnelUploads(db: SupabaseClient): Promise<{ removed: number }> {
  const claimed = await db.rpc('claim_expired_personnel_uploads');
  if (claimed.error) throw databaseError(claimed.error);
  const rows: unknown = claimed.data;
  if (!Array.isArray(rows)) throw new Error('Personnel upload cleanup returned invalid data.');
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    if (!isRecord(row) || !isUuid(row.id) || typeof row.storage_path !== 'string'
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/document$/i.test(row.storage_path)
      || !row.storage_path.endsWith(`/${row.id}/document`)) {
      throw new Error('Personnel upload cleanup returned an invalid reference.');
    }
    const result = await db.storage.from('personnel-documents').remove([row.storage_path]);
    if (result.error) {
      console.error('[personnel/cleanup] Storage removal failed', result.error.name);
      failed++;
      continue;
    }
    const finished = await db.rpc('finish_expired_personnel_upload', { p_id: row.id });
    if (finished.error) {
      console.error('[personnel/cleanup] Reservation finalization failed', finished.error.code);
      failed++;
      continue;
    }
    removed++;
  }
  if (failed) throw new Error(`${failed} expired personnel upload(s) could not be removed. Retry cleanup.`);
  return { removed };
}
