import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';

export interface ResubmissionTarget {
  id: string;
  full_name: string;
  status?: string | null;
  form_payload?: Record<string, unknown> | null;
}

/** The event, current submission, task and notification commit together. */
export async function applyResubmission(
  supabase: SupabaseClient,
  existing: ResubmissionTarget,
  newPayload: Record<string, unknown>,
  contact: { fullName?: string | null; email?: string | null; phone?: string | null },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('apply_website_resubmission', {
    p_lead_id: existing.id, p_payload: newPayload,
    p_full_name: contact.fullName?.trim() || null,
    p_email: contact.email?.trim().toLowerCase() || null,
    p_phone: contact.phone?.trim() || null,
  });
  if (error) throw databaseError(error);
  if (typeof data !== 'boolean') throw new Error('Website resubmission returned an invalid result.');
  return data;
}
