export const WORK_KINDS = ['website', 'reply', 'renewal', 'service', 'reminder', 'task', 'approval', 'delivery'] as const;
export type WorkKind = typeof WORK_KINDS[number];
export interface WorkItem {
  id: string; task_id: string | null; source_id: string; kind: WorkKind;
  subject: string; name: string; reason: string; due_at: string | null; created_at: string;
  assignee: string | null; priority: string; updated_at: string | null; href: string;
  timing: 'overdue' | 'today' | 'unscheduled' | 'upcoming'; urgency: number;
}
export interface WorkdayResponse {
  items: WorkItem[]; total: number; actionable: number; page: number; page_size: number;
  generated_at: string;
}
export function workdayFilters(params: URLSearchParams): { page: number; kind: string; timing: string; assignee: string } {
  const rawPage = params.get('page') ?? '0';
  const page = Number(rawPage);
  const kind = params.get('kind') ?? 'all';
  const timing = params.get('timing') ?? 'all';
  const assignee = (params.get('assignee') ?? '').trim();
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page > 100000) throw new Error('Choose a valid work page.');
  if (kind !== 'all' && !WORK_KINDS.some((value) => value === kind)) throw new Error('Choose a valid work category.');
  if (!['all', 'overdue', 'today', 'unscheduled', 'upcoming'].includes(timing)) throw new Error('Choose a valid due filter.');
  if (assignee.length > 120) throw new Error('Assignee names must be at most 120 characters.');
  return { page, kind, timing, assignee };
}
