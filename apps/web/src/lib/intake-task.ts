import type { SupabaseClient } from '@supabase/supabase-js';
import { startOfArizonaDay, nextArizonaBusinessMorning } from './arizona-time';
import { writeNotification } from './automation';

const ARIZONA_UTC_OFFSET_HOURS = 7; // AZ has no DST

function arizonaFourPm(base: Date): Date {
  const dayStart = startOfArizonaDay(base);
  return new Date(dayStart.getTime() + 16 * 3600 * 1000);
}

/**
 * Guarantees every new lead gets an actionable task — due 4 PM Arizona.
 * Warm leads (website/intake) are high priority and due today; imported or
 * manual leads are medium priority and due the next business day.
 */
export async function scheduleIntakeTask(
  supabase: SupabaseClient,
  input: { leadId: string; name: string; warm: boolean },
): Promise<void> {
  try {
    // Skip only if an actionable (near-term) open task already exists —
    // a far-future X-date task shouldn't suppress the first-contact task.
    const weekOut = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const existing = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('related_type', 'lead')
      .eq('related_id', input.leadId)
      .eq('status', 'open')
      .lte('due_date', weekOut);

    if ((existing.count ?? 0) > 0) return;

    const now = new Date();
    let due: Date;
    if (input.warm) {
      const todayFourPm = arizonaFourPm(now);
      due = now.getTime() < todayFourPm.getTime() - 15 * 60 * 1000
        ? todayFourPm
        : new Date(nextArizonaBusinessMorning(now).getTime() + 7 * 3600 * 1000); // 9 AM + 7h = 4 PM
    } else {
      due = new Date(nextArizonaBusinessMorning(now).getTime() + 7 * 3600 * 1000);
    }

    await supabase.from('tasks').insert([
      {
        subject: input.warm ? `Contact warm lead: ${input.name}` : `Contact new lead: ${input.name}`,
        description: input.warm
          ? 'Warm inbound lead — reach out while interest is fresh.'
          : 'New prospect added to your pipeline — make the first touch.',
        due_date: due.toISOString(),
        status: 'open',
        priority: input.warm ? 'high' : 'medium',
        related_type: 'lead',
        related_id: input.leadId,
      },
    ]);

    if (input.warm) {
      await writeNotification({
        type: 'new_lead',
        message: `Warm lead in: ${input.name} — task due 4 PM today.`,
        href: `/leads?lead=${input.leadId}`,
      });
    }
  } catch {
    // Task creation is best-effort; lead creation must never fail because of it.
  }
}

/** Website submissions carry request context; imports carry prospect_import source. */
export function isWarmSource(source: string | null | undefined, formPayload?: unknown): boolean {
  const normalized = (source ?? '').toLowerCase();
  if (normalized.includes('website') || normalized.includes('web') || normalized.includes('intake')) return true;
  if (formPayload && typeof formPayload === 'object' && formPayload !== null && '_request' in formPayload) return true;
  return false;
}

export { ARIZONA_UTC_OFFSET_HOURS };
