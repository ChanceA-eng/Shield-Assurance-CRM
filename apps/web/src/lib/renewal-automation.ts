import type { SupabaseClient } from '@supabase/supabase-js';
import { agencyDateTimeInput, agencyInputToIso, nextAgencyBusinessMorning, DEFAULT_AGENCY_TIME_ZONE } from './agency-time';
import { BUILT_IN_AUTOMATION_DEFAULTS, type BuiltInAutomationDefaults } from '@crm/shared';
import { getAutomationSettings } from './automation-settings';

/** Renewal work starts this many days before the renewal date. */
export const RENEWAL_WINDOW_DAYS = 45;
/** Lapsed renewals stay on the radar for this many days after the date passes. */
export const RENEWAL_GRACE_DAYS = 7;
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

function agencyToday(now: Date, timeZone: string): string {
  return agencyDateTimeInput(now, timeZone).slice(0, 10);
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

/** Whole agency calendar days until the renewal (negative once it has passed). */
export function daysUntilRenewal(renewalDate: string, now: Date, timeZone = 'America/Phoenix'): number {
  return Math.round((Date.parse(`${renewalDate}T00:00:00Z`) - Date.parse(`${agencyToday(now, timeZone)}T00:00:00Z`)) / DAY_MS);
}

/** The tightest milestone reached, e.g. 12 days out -> 15. Null outside the window. */
export function renewalMilestone(daysUntil: number, policy: BuiltInAutomationDefaults['renewal'] = BUILT_IN_AUTOMATION_DEFAULTS.renewal): number | null {
  if (daysUntil > policy.window_days || daysUntil < -policy.grace_days) return null;
  if (daysUntil <= 0) return 0;
  return [...policy.milestones].reverse().find((milestone) => daysUntil <= milestone) ?? null;
}

export function renewalPriority(daysUntil: number, urgentDays = 15): 'high' | 'medium' {
  return daysUntil <= urgentDays ? 'high' : 'medium';
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
export function renewalTaskDue(renewalDate: string, now: Date, daysBefore = 30, timeZone = 'America/Phoenix'): string {
  const target = agencyInputToIso(`${addDays(renewalDate, -daysBefore)}T09:00`, timeZone);
  if (target && Date.parse(target) > now.getTime()) return target;
  return nextAgencyBusinessMorning(now, timeZone).toISOString();
}

/**
 * Internal-only renewal radar (runs from the daily cron): keeps one renewal
 * task per policy term on the account and raises one notification per
 * milestone (45/30/15/7/due). Never emails or texts the client.
 */
export async function runRenewalRadar(
  supabase: SupabaseClient,
  now = new Date(),
  policyId?: string,
  batch?: { limit: number; after: string | null },
): Promise<{ policies: number; tasksCreated: number; tasksEscalated: number; notifications: number; next_cursor?: string | null }> {
  const { configuration } = await getAutomationSettings(supabase);
  const timeZone = configuration.outreach.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
  const today = agencyToday(now, timeZone);
  const result = { policies: 0, tasksCreated: 0, tasksEscalated: 0, notifications: 0 };
  const settings = configuration.automation.renewal;
  if (!settings.enabled) return result;

  const from = addDays(today, -settings.grace_days);
  const to = addDays(today, settings.window_days);
  const reconciliation = await supabase.rpc('reconcile_legacy_renewal_tasks', { p_policy_id: policyId ?? null });
  if (reconciliation.error) throw new Error(`Renewal reconciliation: ${reconciliation.error.message}`);
  let query = supabase
    .from('policies')
    .select('id,client_id,account_id,insured_name,carrier,line_of_business,policy_number,premium,renewal_date,expiration_date,status')
    .or(`and(renewal_date.gte.${from},renewal_date.lte.${to}),and(renewal_date.is.null,expiration_date.gte.${from},expiration_date.lte.${to})`)
    .in('status', ['active', 'issued', 'bound', 'in_force', 'inforce', 'Active', 'Issued', 'Bound']);
  if (policyId) query = query.eq('id', policyId);
  if (batch?.after) query = query.gt('id', batch.after);
  const policies: RenewalPolicy[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.order('id').range(offset, offset + (batch?.limit ?? 500) - 1);
    if (error) throw new Error(`Renewal policy lookup: ${error.message}`);
    policies.push(...(data ?? []) as RenewalPolicy[]);
    if (batch || !data || data.length < 500) break;
  }

  for (const policy of policies) {
    const accountId = policy.client_id ?? policy.account_id;
    const renewalDate = renewalDateOf(policy);
    if (!accountId || !renewalDate) continue;
    const daysUntil = daysUntilRenewal(renewalDate, now, timeZone);
    const milestone = renewalMilestone(daysUntil, settings);
    if (milestone === null) continue;
    result.policies += 1;

    const marker = renewalMarker(policy.id, renewalDate);
    const name = policy.insured_name?.trim() || 'Policy';
    const priority = renewalPriority(daysUntil, settings.urgent_days_before);

    const premium = policy.premium !== null && policy.premium !== '' ? `$${Number(policy.premium).toLocaleString('en-US')}` : null;
    const persisted = await supabase.rpc('persist_renewal_radar', {
      p_policy_id: policy.id, p_renewal_date: renewalDate, p_milestone: milestone,
      p_task: {
          subject: `Renewal review for ${name}${policy.carrier ? ` (${policy.carrier})` : ''} - ${renewalLabel(daysUntil)}`,
          description: [
            `${[policy.carrier, policy.line_of_business].filter(Boolean).join(' ') || 'Policy'}${policy.policy_number ? ` #${policy.policy_number}` : ''} renews ${renewalDate}.`,
            premium ? `Current premium: ${premium}.` : null,
            'Review coverage, remarket if needed, and confirm renewal with the client.',
            marker,
          ].filter(Boolean).join('\n'),
          due_date: renewalTaskDue(renewalDate, now, settings.task_days_before, timeZone),
          status: 'open',
          priority,
          kind: 'task',
          related_type: 'client',
          related_id: accountId,
      },
      p_message: renewalMilestoneMessage(policy, renewalDate, milestone),
    });
    if (persisted.error) throw new Error(`Renewal ${policy.id}: ${persisted.error.message}`);
    const counts = persisted.data as { tasksCreated: number; tasksEscalated: number; notifications: number };
    result.tasksCreated += counts.tasksCreated;
    result.tasksEscalated += counts.tasksEscalated;
    result.notifications += counts.notifications;
  }

  return { ...result, ...(batch ? { next_cursor: policies.length === batch.limit ? policies[policies.length - 1].id : null } : {}) };
}
