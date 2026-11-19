import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loadTaskTimeliness, parseTaskDueDate, taskTimeliness, type TimelinessTask } from './task-timeliness';

const due = '2026-11-01T12:00:00Z', now = new Date(due);
describe('dashboard task timeliness', () => {
  it('compares actual completion time and never counts unfinished tasks green or completed', () => {
    expect(taskTimeliness([
      { status: 'completed', due_date: due, completed_at: due },
      { status: 'completed', due_date: due, completed_at: '2026-11-01T11:59:59Z' },
      { status: 'completed', due_date: due, completed_at: '2026-11-01T12:00:01Z' },
      { status: 'open', due_date: due, completed_at: null },
      { status: 'open', due_date: '2026-11-01T11:59:59Z', completed_at: null },
      { status: 'completed', due_date: null, completed_at: null },
      { status: 'open', due_date: null, completed_at: null },
      { status: 'cancelled', due_date: due, completed_at: null },
    ], now)).toEqual({ on_time: 3, overdue: 2, open: 2, completed: 4, unclassified: 0 });
  });
  it('does not falsely label missing or malformed completion timing on time', () => {
    expect(taskTimeliness([
      { status: 'completed', due_date: due, completed_at: null },
      { status: 'completed', due_date: due, completed_at: 'invalid' },
      { status: 'open', due_date: 'invalid', completed_at: null },
    ], now)).toEqual({ on_time: 0, overdue: 0, open: 0, completed: 2, unclassified: 3 });
    expect(taskTimeliness([], now)).toEqual({ on_time: 0, overdue: 0, open: 0, completed: 0, unclassified: 0 });
  });
  it('new incoming tasks cannot inflate completed counts and time passing only changes overdue work', () => {
    const row = { status: 'open', due_date: due, completed_at: null };
    expect(taskTimeliness(Array.from({ length: 10 }, () => row), now)).toEqual({
      on_time: 0, overdue: 0, open: 10, completed: 0, unclassified: 0,
    });
    expect(taskTimeliness([row], new Date(now.getTime() + 1))).toEqual({
      on_time: 0, overdue: 1, open: 0, completed: 0, unclassified: 0,
    });
  });
  it('aggregates all pages rather than stopping at the database row limit', async () => {
    const rows: TimelinessTask[] = Array.from({ length: 1001 }, (_, i) => ({
      status: 'completed', due_date: due, completed_at: i < 1000 ? due : '2026-11-01T12:00:01Z',
    }));
    const offsets: string[] = [];
    const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
      fetch: async (input) => {
        const url = new URL(String(input)); offsets.push(url.searchParams.get('offset')!);
        expect(url.pathname).toBe('/rest/v1/active_workspace_tasks');
        expect(url.searchParams.get('order')).toBe('id.asc');
        expect(url.searchParams.get('status')).toBe('in.(open,completed)');
        return Response.json(rows.slice(Number(url.searchParams.get('offset')), Number(url.searchParams.get('offset')) + 1000));
      },
    } });
    expect(await loadTaskTimeliness(db, now)).toEqual({ on_time: 1000, overdue: 1, open: 0, completed: 1001, unclassified: 0 });
    expect(offsets).toEqual(['0', '1000']);
  });

  it('interprets date-only deadlines at 4 PM in the agency zone, including daylight saving', async () => {
    const zone = async () => 'America/New_York';
    expect(await parseTaskDueDate('2026-07-14', zone)).toBe('2026-07-14T20:00:00.000Z');
    expect(await parseTaskDueDate('2026-11-19', zone)).toBe('2026-11-19T21:00:00.000Z');
    expect(await parseTaskDueDate('2026-11-19T18:00:00+01:00', zone)).toBe('2026-11-19T17:00:00.000Z');
    await expect(parseTaskDueDate('2026-02-31', zone)).rejects.toMatchObject({ status: 400 });
  });
  it('surfaces database failures rather than returning successful zero counts', async () => {
    const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
      fetch: async () => Response.json({ message: 'Metrics failed', code: 'XX000' }, { status: 500 }),
    } });
    await expect(loadTaskTimeliness(db)).rejects.toThrow();
  });
});
