import type { SupabaseClient } from '@supabase/supabase-js';
import { readRenewalEvidence, renewalEvidenceLabel } from '@crm/shared';
import { isRecord, isUuid } from './workspace-validation';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { nextArizonaBusinessMorning } from './arizona-time';

export interface ImportIdentity {
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  profile?: Record<string, unknown>;
}

export async function importMatches(db: SupabaseClient, prospects: ImportIdentity[], actorId: string): Promise<Map<number, string[]>> {
  const matches = new Map<number, string[]>();
  for (let offset = 0; offset < prospects.length; offset += 200) {
    const result = await db.rpc('intelligence_import_matches', {
      p_actor: actorId, p_candidates: prospects.slice(offset, offset + 200).map((prospect, index) => ({
        full_name: prospect.full_name, email: prospect.email, phone: prospect.phone, address: prospect.address,
        dot_number: isRecord(prospect.profile?.dot) ? prospect.profile.dot.number : null, index: index + offset,
      })),
    });
    if (result.error) throw databaseError(result.error);
    if (!Array.isArray(result.data) || result.data.length !== Math.min(200, prospects.length - offset)) {
      throw new WorkspaceError('Duplicate review could not be verified. No import was staged.', 503);
    }
    for (const row of result.data) {
      if (!isRecord(row) || typeof row.index !== 'number' || !Array.isArray(row.matches)
        || !Number.isInteger(row.index) || row.index < offset || row.index >= offset + Math.min(200, prospects.length - offset)
        || !row.matches.every((value): value is string => typeof value === 'string' && /^(lead|client):/.test(value)
          && isUuid(value.slice(value.indexOf(':') + 1)))) {
        throw new WorkspaceError('Duplicate review returned an invalid result. No import was staged.', 503);
      }
      if (row.matches.length) matches.set(row.index, row.matches);
    }
    if (new Set(result.data.map((row: { index: number }) => row.index)).size !== result.data.length) {
      throw new WorkspaceError('Duplicate review did not cover every prospect. No import was staged.', 503);
    }
  }
  return matches;
}

export function classifiedImportProfile(profile: Record<string, unknown>): Record<string, unknown> {
  return { ...profile, renewals: readRenewalEvidence(profile.renewals).map((renewal) => ({
    ...renewal, evidence_class: renewal.evidence_class === 'confirmed' ? 'vendor_reported' : renewal.evidence_class,
  })) };
}

export function importRenewalTasks(name: string, profile: Record<string, unknown>, now = new Date(), policy: {
  enabled?: boolean; daysBefore?: number;
} = {}): Array<{
  subject: string; description: string; due_date: string; renewal_date: string; renewal_precision: 'month' | 'date';
}> {
  const tasks: Array<{ subject: string; description: string; due_date: string; renewal_date: string; renewal_precision: 'month' | 'date' }> = [];
  if (policy.enabled === false) return tasks;
  const daysBefore = policy.daysBefore ?? 60;
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) throw new Error('Imported renewal timing must be between 0 and 365 days.');
  for (const renewal of readRenewalEvidence(profile.renewals)) {
    if (renewal.evidence_class === 'unknown') continue;
    const day = renewal.precision === 'month' ? `${renewal.date.slice(0, 7)}-01` : renewal.date;
    const renewalStart = new Date(`${day}T09:00:00-07:00`);
    const end = renewal.precision === 'month'
      ? new Date(Date.UTC(renewalStart.getUTCFullYear(), renewalStart.getUTCMonth() + 1, 1, 7))
      : new Date(renewalStart.getTime() + 86400000);
    if (end <= now) continue;
    const early = new Date(renewalStart.getTime() - daysBefore * 86400000);
    const due = early > now ? early : new Date(nextArizonaBusinessMorning(now, true).getTime() + 3600000);
    const description = `${renewalEvidenceLabel(renewal)}. This is imported intelligence, not proof of a current policy. Confirm timing before outreach.`
      + (renewal.carrier ? ` Reported carrier: ${renewal.carrier}.` : '')
      + (renewal.broker ? ` Reported broker: ${renewal.broker}.` : '')
      + (renewal.source_field ? ` Source field: ${renewal.source_field}.` : '');
    if (tasks.some((task) => task.subject === `${name} - verify ${renewal.type} renewal timing` && task.description === description)) continue;
    tasks.push({ subject: `${name} - verify ${renewal.type} renewal timing`, description, due_date: due.toISOString(),
      renewal_date: day, renewal_precision: renewal.precision });
  }
  return tasks;
}
