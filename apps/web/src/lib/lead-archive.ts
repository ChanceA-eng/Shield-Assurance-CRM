export type LeadArchiveAction = 'archive' | 'restore' | 'delete';

export interface LeadArchiveResult {
  id: string;
  outcome: 'archived' | 'already_archived' | 'restored' | 'not_archived' | 'deleted' | 'missing';
  name?: string;
  tasks_closed?: number;
  sequences_paused?: number;
  drafts_rejected?: number;
  requests_dismissed?: number;
  tasks_reopened?: number;
}

const OUTCOMES = new Set<LeadArchiveResult['outcome']>(['archived', 'already_archived', 'restored', 'not_archived', 'deleted', 'missing']);

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function parseLeadArchiveResults(value: unknown): LeadArchiveResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: LeadArchiveResult[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.outcome !== 'string' || !OUTCOMES.has(row.outcome as LeadArchiveResult['outcome'])) return null;
    results.push({
      id: row.id,
      outcome: row.outcome as LeadArchiveResult['outcome'],
      name: typeof row.name === 'string' ? row.name : undefined,
      tasks_closed: count(row.tasks_closed),
      sequences_paused: count(row.sequences_paused),
      drafts_rejected: count(row.drafts_rejected),
      requests_dismissed: count(row.requests_dismissed),
      tasks_reopened: count(row.tasks_reopened),
    });
  }
  return results;
}

function plural(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

function sum(results: LeadArchiveResult[], key: keyof Pick<LeadArchiveResult, 'tasks_closed' | 'sequences_paused' | 'drafts_rejected' | 'tasks_reopened'>): number {
  return results.reduce((total, result) => total + (result[key] ?? 0), 0);
}

export function describeLeadArchive(action: LeadArchiveAction, results: LeadArchiveResult[]): string {
  const missing = results.filter((result) => result.outcome === 'missing').length;
  const notes: string[] = [];
  if (action === 'delete') {
    const deleted = results.filter((result) => result.outcome === 'deleted').length;
    const kept = results.filter((result) => result.outcome === 'not_archived').length;
    const parts = [deleted
      ? `Permanently deleted ${plural(deleted, 'lead', 'leads')} and all of their tasks, reminders, notes, messages and automation.`
      : 'No leads were deleted.'];
    if (kept) notes.push(`${plural(kept, 'lead was', 'leads were')} skipped because only archived leads can be deleted`);
    if (missing) notes.push(`${plural(missing, 'lead was', 'leads were')} already removed`);
    if (notes.length) parts.push(`${notes.join('; ')}.`);
    return parts.join(' ');
  }
  if (action === 'archive') {
    const done = results.filter((result) => result.outcome === 'archived');
    const skipped = results.filter((result) => result.outcome === 'already_archived').length;
    const parts = [`Archived ${plural(done.length, 'lead', 'leads')}.`];
    const effects = [
      sum(done, 'tasks_closed') ? plural(sum(done, 'tasks_closed'), 'open task closed', 'open tasks closed') : '',
      sum(done, 'sequences_paused') ? plural(sum(done, 'sequences_paused'), 'email sequence paused', 'email sequences paused') : '',
      sum(done, 'drafts_rejected') ? plural(sum(done, 'drafts_rejected'), 'unsent draft cancelled', 'unsent drafts cancelled') : '',
    ].filter(Boolean);
    if (effects.length) parts.push(`${effects.join(', ')}.`);
    if (skipped) notes.push(`${plural(skipped, 'lead was', 'leads were')} already archived`);
    if (missing) notes.push(`${plural(missing, 'lead was', 'leads were')} already removed`);
    if (notes.length) parts.push(`${notes.join('; ')}.`);
    return parts.join(' ');
  }
  const done = results.filter((result) => result.outcome === 'restored');
  const skipped = results.filter((result) => result.outcome === 'not_archived').length;
  const parts = [`Restored ${plural(done.length, 'lead', 'leads')}.`];
  const reopened = sum(done, 'tasks_reopened');
  if (reopened) parts.push(`${plural(reopened, 'task was', 'tasks were')} reopened.`);
  const paused = sum(done, 'sequences_paused');
  if (paused) parts.push(`${plural(paused, 'email sequence is', 'email sequences are')} still paused — resume from Outreach when ready.`);
  if (skipped) notes.push(`${plural(skipped, 'lead was', 'leads were')} not archived`);
  if (missing) notes.push(`${plural(missing, 'lead was', 'leads were')} already removed`);
  if (notes.length) parts.push(`${notes.join('; ')}.`);
  return parts.join(' ');
}
