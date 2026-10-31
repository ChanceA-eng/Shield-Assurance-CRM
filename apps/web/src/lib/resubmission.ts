/**
 * Resubmission handling: when someone fills the website form again, the lead
 * keeps ONE pipeline card — the new submission becomes the current profile,
 * earlier submissions are archived on the payload, and the producer gets a
 * hot "call now" task because repeat inquiries close fast.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeNotification } from './automation';

export interface ResubmissionTarget {
  id: string;
  full_name: string;
  status?: string | null;
  form_payload?: Record<string, unknown> | null;
}

const HISTORY_CAP = 5;

export async function applyResubmission(
  supabase: SupabaseClient,
  existing: ResubmissionTarget,
  newPayload: Record<string, unknown>,
  contact: { fullName?: string | null; email?: string | null; phone?: string | null },
): Promise<void> {
  const now = new Date();

  // Archive the current submission under previous_submissions (newest last).
  const prior = (existing.form_payload ?? {}) as Record<string, unknown>;
  const history = Array.isArray(prior.previous_submissions)
    ? (prior.previous_submissions as Array<Record<string, unknown>>)
    : [];
  const archived = { ...prior };
  delete archived.previous_submissions;
  const merged = {
    ...newPayload,
    previous_submissions: [...history, archived].slice(-HISTORY_CAP),
  };

  const update: Record<string, unknown> = {
    form_payload: merged,
    last_activity_at: now.toISOString(),
  };
  if (contact.fullName?.trim()) update.full_name = contact.fullName.trim();
  if (contact.email?.trim()) update.email = contact.email.trim().toLowerCase();
  if (contact.phone?.trim()) update.phone = contact.phone.trim();

  // Renewed interest revives closed-out leads.
  const status = (existing.status ?? '').toLowerCase();
  if (status === 'lost' || status === 'inactive') {
    update.status = 'new';
    update.stage_changed_at = now.toISOString();
    update.lost_reason = null;
  }

  await supabase.from('leads').update(update).eq('id', existing.id);

  await supabase.from('interactions').insert([
    {
      lead_id: existing.id,
      content: 'Submitted the website form again with updated details. Earlier submission is archived on the profile.',
      follow_up_completed: true,
    },
  ]);

  const name = contact.fullName?.trim() || existing.full_name;
  const hotDue = new Date(now.getTime() + 2 * 3600 * 1000);
  await supabase.from('tasks').insert([
    {
      subject: `${name} submitted another request — call now`,
      description: 'They filled out the website form again with new details. Repeat inquiries close fast.',
      due_date: hotDue.toISOString(),
      status: 'open',
      priority: 'high',
      related_type: 'lead',
      related_id: existing.id,
    },
  ]);
  await writeNotification({
    type: 'new_lead',
    message: `${name} submitted another request — review the updated details`,
    href: `/leads?lead=${existing.id}`,
  });
}
