'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock, Flag, Plus, User } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import LeadWorkspace, { type WorkspaceLead } from '../leads/LeadWorkspace';
import { arizonaInputToIso, endOfArizonaDay, formatArizonaDateTime, startOfArizonaDay } from '../../lib/arizona-time';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import { useNotifications } from '../../context/NotificationContext';

interface Task {
  id: string;
  subject: string;
  description?: string | null;
  due_date?: string | null;
  status?: string | null;
  priority?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  related_name?: string | null;
  related_status?: string | null;
  created_at: string;
  completed_at?: string | null;
  kind?: string;
  updated_at?: string;
}

type Scope = 'all' | 'lead' | 'client' | 'none';

interface Bucket {
  key: string;
  label: string;
  tone: string;
  tasks: Task[];
}

function bucketize(tasks: Task[]): Bucket[] {
  const now = Date.now();
  const today = endOfArizonaDay(new Date()).getTime() - 1;
  const tomorrow = today + 86400000;
  const week = today + 7 * 86400000;

  const buckets: Bucket[] = [
    { key: 'overdue', label: 'Overdue', tone: 'text-cui-danger', tasks: [] },
    { key: 'today', label: 'Today', tone: 'text-amber-700', tasks: [] },
    { key: 'tomorrow', label: 'Tomorrow', tone: 'text-cui-primary', tasks: [] },
    { key: 'week', label: 'This week', tone: 'text-cui-text', tasks: [] },
    { key: 'later', label: 'Later', tone: 'text-cui-muted', tasks: [] },
    { key: 'nodate', label: 'No due date', tone: 'text-cui-muted', tasks: [] },
  ];

  for (const task of tasks) {
    if (!task.due_date) {
      buckets[5].tasks.push(task);
      continue;
    }
    const due = new Date(task.due_date).getTime();
    if (due < now) buckets[0].tasks.push(task);
    else if (due <= today) buckets[1].tasks.push(task);
    else if (due <= tomorrow) buckets[2].tasks.push(task);
    else if (due <= week) buckets[3].tasks.push(task);
    else buckets[4].tasks.push(task);
  }

  return buckets.filter((bucket) => bucket.tasks.length > 0);
}

function dueLabel(value: string | null | undefined): string {
  if (!value) return '';
  return `${formatArizonaDateTime(value)} AZ`;
}

export default function TasksPage(): JSX.Element {
  const { refresh } = useNotifications();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [view, setView] = useState<'open' | 'completed'>('open');
  const [completed, setCompleted] = useState<Task[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerLead, setDrawerLead] = useState<WorkspaceLead | null>(null);

  // Quick add
  const [quickSubject, setQuickSubject] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [quickPriority, setQuickPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isAdding, setIsAdding] = useState(false);

  const fetchTasks = useCallback(async (): Promise<void> => {
    try {
      const [openRows, doneRows] = await Promise.all([
        workspacePages<Task>('/api/tasks?status=open&sort=due_asc&limit=200&include=related', 200, 'offset'),
        workspacePages<Task>('/api/tasks?status=completed&sort=completed_desc&limit=200&include=related', 200, 'offset'),
      ]);
      setTasks(openRows);
      setCompleted(doneRows);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Network error while loading tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    const interval = window.setInterval(() => void fetchTasks(), 30000);
    return () => window.clearInterval(interval);
  }, [fetchTasks]);

  const scoped = useMemo(() => {
    if (scope === 'all') return tasks;
    if (scope === 'none') return tasks.filter((task) => !task.related_type);
    return tasks.filter((task) => task.related_type === scope);
  }, [tasks, scope]);

  const buckets = useMemo(() => bucketize(scoped), [scoped]);

  const updateTask = async (taskId: string, patch: Record<string, unknown>): Promise<void> => {
    const task = [...tasks, ...completed].find((row) => row.id === taskId);
    if (!task) { setError('This task is no longer on the current list. Refresh before retrying.'); return; }
    setBusyId(taskId);
    try {
      await workspaceFetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, expected_updated_at: task.updated_at, ...patch }),
      });
      await fetchTasks();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update this task.');
    } finally {
      setBusyId(null);
    }
  };

  const snooze = (task: Task, option: 'later' | 'tomorrow' | 'nextweek'): void => {
    const due = option === 'later' ? new Date(Date.now() + 4 * 3600000)
      : new Date(startOfArizonaDay(new Date()).getTime() + (option === 'tomorrow' ? 1 : 7) * 86400000 + 16 * 3600000);
    void updateTask(task.id, { due_date: due.toISOString() });
  };

  const quickAdd = async (): Promise<void> => {
    const subject = quickSubject.trim();
    if (!subject) { setError('Enter a task action.'); return; }
    setIsAdding(true);
    try {
      let dueIso: string;
      if (quickDue) {
        const value = arizonaInputToIso(quickDue);
        if (!value) { setError('Choose a valid Arizona date and time.'); return; }
        dueIso = value;
      } else {
        const tomorrow = new Date(startOfArizonaDay(new Date()).getTime() + 86400000 + 16 * 3600000);
        dueIso = tomorrow.toISOString();
      }
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, due_date: dueIso, priority: quickPriority }),
      });
      if (!res.ok) {
        setError('Failed to add task.');
        return;
      }
      setQuickSubject('');
      setQuickDue('');
      setQuickPriority('medium');
      await fetchTasks();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to add this task.');
    } finally {
      setIsAdding(false);
    }
  };

  const openRecord = async (task: Task): Promise<void> => {
    if (task.related_type === 'lead' && task.related_id) {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(task.related_id)}`, { cache: 'no-store' });
        if (res.ok) {
          setDrawerLead((await res.json()) as WorkspaceLead);
          return;
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to open the linked lead.');
        return;
      }
      setError('The linked lead could not be opened. Refresh before trying again.');
    }
    if (task.related_type === 'client' && task.related_id) {
      window.location.assign(`/clients/${task.related_id}`);
    }
  };

  const openCount = scoped.length;

  return (
    <SectionLayout title="Tasks">
      {/* Quick add */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-cui-border/60 bg-white p-3 shadow-card">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs font-semibold text-cui-muted">General task (use a profile to create linked work)</label>
          <input
            type="text"
            value={quickSubject}
            onChange={(event) => setQuickSubject(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void quickAdd();
            }}
            placeholder="What needs doing? (Enter to add — defaults to tomorrow 4 PM)"
            className="w-full rounded border border-cui-border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-cui-muted">Due - Arizona (UTC-7)</label>
          <input
            type="datetime-local"
            value={quickDue}
            onChange={(event) => setQuickDue(event.target.value)}
            className="rounded border border-cui-border px-2 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-cui-muted">Priority</label>
          <select
            value={quickPriority}
            onChange={(event) => setQuickPriority(event.target.value as 'low' | 'medium' | 'high')}
            className="rounded border border-cui-border px-2 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => void quickAdd()}
          disabled={isAdding || quickSubject.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {isAdding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {/* View toggle + scope filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <div className="mr-2 inline-flex overflow-hidden rounded border border-[#d5dde5]">
          <button
            type="button"
            onClick={() => setView('open')}
            className={`px-3 py-1.5 font-semibold ${view === 'open' ? 'bg-[#167495] text-white' : 'bg-white text-[#28557f] hover:bg-cui-light'}`}
          >
            Open ({tasks.length})
          </button>
          <button
            type="button"
            onClick={() => setView('completed')}
            className={`px-3 py-1.5 font-semibold ${view === 'completed' ? 'bg-[#167495] text-white' : 'bg-white text-[#28557f] hover:bg-cui-light'}`}
          >
            Completed ({completed.length})
          </button>
        </div>
        {view === 'open'
          ? (
              [
                ['all', `All (${tasks.length})`],
                ['lead', `Leads (${tasks.filter((t) => t.related_type === 'lead').length})`],
                ['client', `Clients (${tasks.filter((t) => t.related_type === 'client').length})`],
                ['none', `Unlinked (${tasks.filter((t) => !t.related_type).length})`],
              ] as Array<[Scope, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={`rounded border px-3 py-1.5 font-semibold ${
                  scope === key ? 'border-[#167495] bg-[#167495] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
                }`}
              >
                {label}
              </button>
            ))
          : null}
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <p className="text-sm text-cui-muted">Loading tasks…</p> : null}

      {!loading && view === 'open' && openCount === 0 ? (
        <div className="rounded border border-dashed border-cui-border bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cui-success" />
          <p className="mt-2 text-sm font-semibold text-cui-text">All clear</p>
          <p className="text-xs text-cui-muted">No open tasks in this view.</p>
        </div>
      ) : null}

      {!loading && view === 'completed' && completed.length === 0 ? (
        <div className="rounded border border-dashed border-cui-border bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cui-muted" />
          <p className="mt-2 text-sm font-semibold text-cui-text">Nothing completed yet</p>
          <p className="text-xs text-cui-muted">Finished tasks land here — with a Reopen button in case one gets checked off by accident.</p>
        </div>
      ) : null}

      {/* Buckets */}
      <div className="space-y-5">
        {view === 'open'
          ? buckets.map((bucket) => (
          <section key={bucket.key}>
            <h2 className={`mb-2 text-sm font-bold uppercase tracking-wide ${bucket.tone}`}>
              {bucket.label} <span className="font-normal opacity-70">({bucket.tasks.length})</span>
            </h2>
            <div className="divide-y divide-cui-light rounded border border-cui-border/60 bg-white shadow-card">
              {bucket.tasks.map((task) => {
                const isHigh = (task.priority ?? '').toLowerCase() === 'high';
                return (
                  <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => void updateTask(task.id, { status: 'completed' })}
                      disabled={busyId === task.id}
                      className="shrink-0 text-cui-muted transition hover:text-cui-success disabled:opacity-50"
                      title="Mark complete"
                      aria-label={`Complete ${task.subject}`}
                    >
                      <Circle className="h-5 w-5" />
                    </button>

                    <div className="min-w-0 flex-[1_1_12rem]">
                      <div className="flex items-center gap-2">
                        {isHigh ? <Flag className="h-3.5 w-3.5 shrink-0 text-cui-danger" /> : null}
                        {task.kind === 'reminder' ? <span className="rounded bg-cui-primary/10 px-1.5 text-[10px] font-semibold text-cui-primary">Reminder</span> : null}
                        <p className="truncate text-sm font-semibold text-cui-text">{task.subject}</p>
                      </div>
                      {task.description ? <p className="truncate text-xs text-cui-muted">{task.description}</p> : null}
                      <p className="text-xs text-cui-muted md:hidden">{dueLabel(task.due_date) || 'No due date'}</p>
                    </div>

                    {task.related_name ? (
                      <button
                        type="button"
                        onClick={() => void openRecord(task)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cui-primary/30 bg-cui-primary/5 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/15"
                        title={`Open ${task.related_name}`}
                      >
                        <User className="h-3 w-3" />
                        <span className="max-w-36 truncate">Open {task.related_name}</span>
                      </button>
                    ) : null}

                    <span className="hidden shrink-0 items-center gap-1 text-xs text-cui-muted md:inline-flex">
                      <Clock className="h-3.5 w-3.5" />
                      {dueLabel(task.due_date) || 'No due date'}
                    </span>

                    <select
                      defaultValue=""
                      disabled={busyId === task.id}
                      onChange={(event) => {
                        const option = event.target.value as 'later' | 'tomorrow' | 'nextweek' | '';
                        event.target.value = '';
                        if (option) snooze(task, option);
                      }}
                      className="shrink-0 rounded border border-cui-border bg-white px-2 py-1 text-xs text-cui-muted"
                    >
                      <option value="" disabled>Snooze…</option>
                      <option value="later">Later today</option>
                      <option value="tomorrow">Tomorrow 4 PM</option>
                      <option value="nextweek">Next week</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
          ))
          : null}

        {view === 'completed' && completed.length > 0 ? (
          <section>
            <div className="divide-y divide-cui-light rounded border border-cui-border/60 bg-white shadow-card">
              {completed.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-cui-success" />
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <p className="truncate text-sm text-cui-muted line-through">{task.subject}</p>
                    {task.description ? <p className="truncate text-xs text-cui-muted/70">{task.description}</p> : null}
                    <p className="text-xs text-cui-muted md:hidden">{dueLabel(task.due_date) || 'No due date'}</p>
                  </div>
                  {task.related_name ? (
                    <button
                      type="button"
                      onClick={() => void openRecord(task)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cui-primary/30 bg-cui-primary/5 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/15"
                      title={`Open ${task.related_name}`}
                    >
                      <User className="h-3 w-3" />
                      <span className="max-w-36 truncate">Open {task.related_name}</span>
                    </button>
                  ) : null}
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-cui-muted md:inline-flex">
                    <Clock className="h-3.5 w-3.5" />
                    {dueLabel(task.due_date) || 'No due date'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void updateTask(task.id, { status: 'open' })}
                    disabled={busyId === task.id}
                    aria-label={`Reopen ${task.subject}`}
                    className="shrink-0 rounded border border-cui-primary/40 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/10 disabled:opacity-50"
                  >
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {drawerLead ? (
        <LeadWorkspace
          lead={drawerLead}
          onClose={() => setDrawerLead(null)}
          onChanged={() => void fetchTasks()}
        />
      ) : null}
    </SectionLayout>
  );
}
