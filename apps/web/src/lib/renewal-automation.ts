import type { SupabaseClient } from '@supabase/supabase-js';
import { arizonaDateTimeInput, arizonaInputToIso, nextArizonaBusinessMorning } from './arizona-time';
import { writeNotification } from './automation';

/** Renewal work starts this many days before the renewal date. */
export const RENEWAL_WINDOW_DAYS = 45;
/** Lapsed renewals stay on the radar for this many days after the date passes. */
export const RENEWAL_GRACE_DAYS = 7;
const MILESTONES = [45, 30, 15, 7, 0] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RenewalPolicy {
  id: string;
  client_id: string | null;
  account_id: string | null;
  insured_name: string | null;
  carrier: string | null;
  line_of_business: string | null;
  policy_number: string | null;
  premium: number | string | null;
  renewal_date: string | null;
  expiration_date: string | null;
  status: string | null;
}

function arizonaToday(now: Date): string {
  return arizonaDateTimeInput(now).slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function renewalDateOf(policy: Pick<RenewalPolicy, 'renewal_date' | 'expiration_date'>): string | null {
  const raw = policy.renewal_date || policy.expiration_date;
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** Whole Arizona calendar days until the renewal (negative once it has passed). */
export function daysUntilRenewal(renewalDate: string, now: Date): number {
  return Math.round((Date.parse(`${renewalDate}T00:00:00Z`) - Date.parse(`${arizonaToday(now)}T00:00:00Z`)) / DAY_MS);
}

/** The tightest milestone reached, e.g. 12 days out -> 15. Null outside the window. */
export function renewalMilestone(daysUntil: number): number | null {
  if (daysUntil > RENEWAL_WINDOW_DAYS || daysUntil < -RENEWAL_GRACE_DAYS) return null;
  if (daysUntil <= 0) return 0;
  return [...MILESTONES].reverse().find((milestone) => daysUntil <= milestone) ?? null;
}

export function renewalPriority(daysUntil: number): 'high' | 'medium' {
  return daysUntil <= 15 ? 'high' : 'medium';
}

export function renewalMarker(policyId: string, renewalDate: string): string {
  return `[renewal:${policyId}:${renewalDate}]`;
}

export function renewalLabel(daysUntil: number): string {
  if (daysUntil < 0) return `lapsed ${Math.abs(daysUntil)} day${daysUntil === -1 ? '' : 's'} ago`;
  if (daysUntil === 0) return 'renews today';
  return `renews in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
}

export function renewalMilestoneMessage(policy: RenewalPolicy, renewalDate: string, milestone: number): string {
  const name = policy.insured_name?.trim() || 'Policy';
  const what = [policy.carrier, policy.line_of_business].filter(Boolean).join(' ');
  const when = milestone === 0 ? 'is due now' : `is within ${milestone} days`;
  return `Renewal ${when}: ${name}${what ? ` (${what})` : ''} renews ${renewalDate}.`;
}

/** First working morning on/after 30 days before renewal (or the next one if that has passed). */
export function renewalTaskDue(renewalDate: string, now: Date): string {
  const target = arizonaInputToIso(`${addDays(renewalDate, -30)}T09:00`);
  if (target && Date.parse(target) > now.getTime()) return target;
  return nextArizonaBusinessMorning(now).toISOString();
}

/**
 * Internal-only renewal radar (runs from the daily cron): keeps one renewal
 * task per policy term on the account and raises one notification per
 * milestone (45/30/15/7/due). Never emails or texts the client.
 */
export async function runRenewalRadar(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ policies: number; tasksCreated: number; tasksEscalated: number; notifications: number }> {
  const today = arizonaToday(now);
  const result = { policies: 0, tasksCreated: 0, tasksEscalated: 0, notifications: 0 };

  const from = addDays(today, -RENEWAL_GRACE_DAYS);
  const to = addDays(today, RENEWAL_WINDOW_DAYS);
  const { data, error } = await supabase
    .from('policies')
    .select('id,client_id,account_id,insured_name,carrier,line_of_business,policy_number,premium,renewal_date,expiration_date,status')
    .or(`and(renewal_date.gte.${from},renewal_date.lte.${to}),and(renewal_date.is.null,expiration_date.gte.${from},expiration_date.lte.${to})`)
    .in('status', ['active', 'issued', 'bound', 'in_force', 'inforce', 'Active', 'Issued', 'Bound'])
    .limit(500);
  if (error) throw new Error(error.message);

  for (const policy of (data ?? []) as RenewalPolicy[]) {
    const accountId = policy.client_id ?? policy.account_id;
    const renewalDate = renewalDateOf(policy);
    if (!accountId || !renewalDate) continue;
    const daysUntil = daysUntilRenewal(renewalDate, now);
    const milestone = renewalMilestone(daysUntil);
    if (milestone === null) continue;
    result.policies += 1;

    const marker = renewalMarker(policy.id, renewalDate);
    const name = policy.insured_name?.trim() || 'Policy';
    const priority = renewalPriority(daysUntil);

    const existing = await supabase
      .from('tasks')
      .select('id,status,priority')
      .eq('related_type', 'client')
      .eq('related_id', accountId)
      .ilike('description', `%${marker}%`)
      .limit(1);
    const task = (existing.data ?? [])[0] as { id: string; status: string; priority: string } | undefined;

    if (!task) {
      const premium = policy.premium !== null && policy.premium !== '' ? `$${Number(policy.premium).toLocaleString('en-US')}` : null;
      const { error: insertError } = await supabase.from('tasks').insert([
        {
          subject: `Renewal review for ${name}${policy.carrier ? ` (${policy.carrier})` : ''} - ${renewalLabel(daysUntil)}`,
          description: [
            `${[policy.carrier, policy.line_of_business].filter(Boolean).join(' ') || 'Policy'}${policy.policy_number ? ` #${policy.policy_number}` : ''} renews ${renewalDate}.`,
            premium ? `Current premium: ${premium}.` : null,
            'Review coverage, remarket if needed, and confirm renewal with the client.',
            marker,
          ].filter(Boolean).join('\n'),
          due_date: renewalTaskDue(renewalDate, now),
          status: 'open',
          priority,
          kind: 'task',
          related_type: 'client',
          related_id: accountId,
        },
      ]);
      if (!insertError) result.tasksCreated += 1;
    } else if (task.status === 'open' && priority === 'high' && task.priority !== 'high') {
      const { error: updateError } = await supabase.from('tasks').update({ priority: 'high' }).eq('id', task.id);
      if (!updateError) result.tasksEscalated += 1;
    }

    const message = renewalMilestoneMessage(policy, renewalDate, milestone);
    const href = `/clients/${accountId}?tab=policies`;
    const already = await supabase
      .from('notifications')
      .select('id')
      .eq('type', 'renewal')
      .eq('message', message)
      .limit(1);
    if ((already.data ?? []).length === 0) {
      await writeNotification({ client_id: accountId, type: 'renewal', message, href });
      result.notifications += 1;
    }
  }

  return result;
}
