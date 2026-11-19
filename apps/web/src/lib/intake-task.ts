import type { SupabaseClient } from '@supabase/supabase-js';

const ARIZONA_UTC_OFFSET_HOURS = 7; // AZ has no DST

/** All intake sources share the database's locked, configured scheduling path. */
export async function scheduleIntakeTask(
  supabase: SupabaseClient,
  input: { leadId: string; name: string; warm: boolean },
): Promise<{ created: boolean; error?: string }> {
  let created = false;
  try {
    const result = await supabase.rpc('schedule_lead_intake', { p_lead: input.leadId, p_warm: input.warm });
    if (result.error) throw new Error(result.error.message);
    if (typeof result.data !== 'boolean') throw new Error('Intake scheduling returned an invalid result.');
    created = result.data;
    return { created };
  } catch (error) {
    console.error('[intake-task] Follow-up scheduling failed', error);
    return { created, error: 'The lead was saved, but follow-up setup failed. Review its Tasks before retrying.' };
  }
}

/** Website submissions carry request context; imports carry prospect_import source. */
export function isWarmSource(source: string | null | undefined, formPayload?: unknown): boolean {
  const normalized = (source ?? '').toLowerCase();
  if (
    normalized.includes('website') ||
    normalized.includes('web') ||
    normalized.includes('intake') ||
    normalized.includes('guided') ||
    normalized.includes('quote') ||
    normalized.includes('review')
  ) {
    return true;
  }
  if (formPayload && typeof formPayload === 'object' && formPayload !== null && '_request' in formPayload) return true;
  return false;
}

export { ARIZONA_UTC_OFFSET_HOURS };
