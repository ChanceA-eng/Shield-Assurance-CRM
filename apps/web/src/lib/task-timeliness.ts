import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';
import { agencyInputToIso } from './agency-time';
import { WorkspaceError } from './record-scope';
import { absoluteDateTime, isRecord } from './workspace-validation';
import type { TaskScope } from './task-access';

export interface TaskTimeliness { on_time: number; overdue: number; open: number; completed: number; unclassified: number }
export interface TimelinessTask { status: string; due_date: string | null; completed_at: string | null }

export async function parseTaskDueDate(value: unknown, loadTimeZone: () => Promise<string>): Promise<string | null> {
  if (value === null || value === '') return null;
  const due = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? agencyInputToIso(`${value}T16:00`, await loadTimeZone())
    : absoluteDateTime(value);
  if (!due) throw new WorkspaceError('Choose a valid task date and time.', 400);
  return due;
}

export function taskTimeliness(rows: TimelinessTask[], now = new Date()): TaskTimeliness {
  const result: TaskTimeliness = { on_time: 0, overdue: 0, open: 0, completed: 0, unclassified: 0 };
  for (const row of rows) {
    if (row.status !== 'open' && row.status !== 'completed') continue;
    if (row.status === 'completed') result.completed++;
    const due = row.due_date === null ? null : Date.parse(row.due_date);
    const completed = row.completed_at === null ? null : Date.parse(row.completed_at);
    if ((due !== null && !Number.isFinite(due)) || (completed !== null && !Number.isFinite(completed))
      || (row.status === 'completed' && due !== null && completed === null)) { result.unclassified++; continue; }
    if (due !== null && (row.status === 'completed' ? completed !== null && completed > due : now.getTime() > due)) result.overdue++;
    else if (row.status === 'completed') result.on_time++;
    else result.open++;
  }
  return result;
}

export async function loadTaskTimeliness(db: SupabaseClient, now = new Date(), access?: { actor: string; scope: TaskScope }): Promise<TaskTimeliness> {
  const total: TaskTimeliness = { on_time: 0, overdue: 0, open: 0, completed: 0, unclassified: 0 };
  for (let offset = 0; ; offset += 1000) {
    let query = (access?.scope === 'assigned'
      ? db.rpc('team_assigned_workspace_tasks', { p_actor: access.actor, p_include_archived: false }).select('status,due_date,completed_at')
      : db.from('active_workspace_tasks').select('status,due_date,completed_at')).in('status', ['open', 'completed']);
    if (access?.scope === 'self') query = query.eq('created_by_user_id', access.actor).is('related_id', null).is('account_id', null);
    const { data, error } = await query.order('id').range(offset, offset + 999);
    if (error) throw databaseError(error);
    const raw: unknown = data;
    if (!Array.isArray(raw) || !raw.every((row: unknown): row is TimelinessTask => isRecord(row)
      && typeof row.status === 'string'
      && (row.due_date === null || typeof row.due_date === 'string')
      && (row.completed_at === null || typeof row.completed_at === 'string'))) {
      throw new Error('Task metrics returned invalid rows.');
    }
    const counts = taskTimeliness(raw, now);
    total.on_time += counts.on_time; total.overdue += counts.overdue; total.unclassified += counts.unclassified;
    total.open += counts.open; total.completed += counts.completed;
    if (raw.length < 1000) return total;
  }
}
