'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock, Flag, Plus, User } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import LeadWorkspace, { type WorkspaceLead } from '../leads/LeadWorkspace';
import { arizonaInputToIso, endOfArizonaDay, formatArizonaDateTime, startOfArizonaDay } from '../../lib/arizona-time';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import TaskSnooze from '../../components/crm/TaskSnooze';
import { useNotifications } from '../../context/NotificationContext';
import { taskRecordHref } from '../../lib/task-links';
import RecordPicker from '../../components/crm/RecordPicker';

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
  related_href?: string | null;
  account_id?: string | null;
  created_at: string;
  completed_at?: string | null;
  kind?: string;
  updated_at?: string;
  assignee?: string | null;
  action_href?: string | null;
  action_category?: string | null;
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
  const [assignment, setAssignment] = useState<{ id: string; name: string } | null>(null);

  // Quick add
  const [quickSubject, setQuickSubject] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [quickPriority, setQuickPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isAdding, setIsAdding] = useState(false);
  const [quickRecordType, setQuickRecordType] = useState<'' | 'lead' | 'client'>('');
  const [quickRecordId, setQuickRecordId] = useState('');
  const [quickAssignee, setQuickAssignee] = useState('');
  const [quickId, setQuickId] = useState<string | null>(null);

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
    if (scope === 'client') return tasks.filter((task) => task.related_type === 'client' || Boolean(task.account_id));
    return tasks.filter((task) => task.related_type === scope);
  }, [tasks, scope]);

  const buckets = useMemo(() => bucketize(scoped), [scoped]);

  const updateTask = async (taskId: string, patch: Record<string, unknown>): Promise<boolean> => {
    const task = [...tasks, ...completed].find((row) => row.id === taskId);
    if (!task) { setError('This task is no longer on the current list. Refresh before retrying.'); return false; }
    setBusyId(taskId);
    setError(null);
    try {
      await workspaceFetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, expected_updated_at: task.updated_at, ...patch }),
      });
      await fetchTasks();
      await refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update this task.');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const quickAdd = async (): Promise<void> => {
    if (isAdding) return;
    const subject = quickSubject.trim();
    if (!subject) { setError('Enter a task action.'); return; }
    if (quickRecordType && !quickRecordId) { setError('Choose the related lead or account.'); return; }
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
      const id = quickId ?? crypto.randomUUID();
      setQuickId(id);
      await workspaceFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subject, due_date: dueIso, priority: quickPriority, assignee: quickAssignee.trim() || null, related_type: quickRecordType || null, related_id: quickRecordId || null }),
      });
      setQuickId(null);
      setQuickSubject('');
      setQuickDue('');
      setQuickPriority('medium');
      setQuickRecordType(''); setQuickRecordId(''); setQuickAssignee('');
      await fetchTasks();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to add this task.');
    } finally {
      setIsAdding(false);
    }
  };

  const openRecord = async (task: Task): Promise<void> => {
    if (task.action_href) {
      const href = taskRecordHref(task);
      if (href) { window.location.assign(href); return; }
    }
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
    const href = task.related_href ?? taskRecordHref(task);
    if (href && task.related_type !== 'lead') window.location.assign(href);
    else if (task.related_type !== 'lead') setError('This task has no available linked record. Open its profile or repair the relationship before retrying.');
  };

  const openCount = scoped.length;

  return (
    <SectionLayout title="Tasks">
      {/* Quick add */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-cui-border/60 bg-white p-3 shadow-card">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs font-semibold text-cui-muted">Task action</label>
          <input
            aria-label="Task action"
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
        <div><label className="mb-1 block text-xs font-semibold text-cui-muted">Link to</label><select aria-label="Task record type" value={quickRecordType} onChange={(event) => { setQuickRecordType(event.target.value === 'lead' ? 'lead' : event.target.value === 'client' ? 'client' : ''); setQuickRecordId(''); }} className="rounded border border-cui-border px-3 py-2 text-sm"><option value="">General task</option><option value="lead">Lead</option><option value="client">Account</option></select></div>
        <div><label className="mb-1 block text-xs font-semibold text-cui-muted">Assignee (optional)</label><input aria-label="Task assignee" maxLength={120} value={quickAssignee} onChange={(event) => setQuickAssignee(event.target.value)} placeholder="Agent name" className="rounded border border-cui-border px-3 py-2 text-sm" /></div>
        {quickRecordType ? <div className="basis-full"><RecordPicker type={quickRecordType} value={quickRecordId} onChange={setQuickRecordId} /></div> : null}
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
                ['client', `Accounts (${tasks.filter((t) => t.related_type === 'client' || Boolean(t.account_id)).length})`],
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

      {assignment ? <form aria-label="Reassign task" className="mb-4 flex flex-wrap items-end gap-3 rounded border border-cui-border bg-white p-3" onSubmit={(event) => {
        event.preventDefault();
        void updateTask(assignment.id, { assignee: assignment.name.trim() || null }).then((ok) => { if (ok) setAssignment(null); });
      }}>
        <label className="text-xs font-semibold">Assignee<input aria-label="New assignee" autoFocus maxLength={120} value={assignment.name} onChange={(event) => setAssignment({ ...assignment, name: event.target.value })} className="mt-1 block rounded border border-cui-border p-2" /></label>
        <button disabled={busyId !== null} className="rounded bg-cui-primary px-3 py-2 text-xs text-white">Save assignment</button>
        <button type="button" disabled={busyId !== null} onClick={() => setAssignment(null)} className="text-xs text-cui-muted">Cancel</button>
      </form> : null}
      {error ? <div role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error} <button type="button" onClick={() => void fetchTasks()} className="font-semibold underline">Refresh tasks</button></div> : null}
      {loading ? <p className="text-sm text-cui-muted">Loading tasks…</p> : null}

      {!loading && view === 'open' && openCount === 0 ? (
        <div className="rounded border border-dashed border-cui-border bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cui-success" />
          <p className="mt-2 text-sm font-semibold text-cui-text">No saved tasks</p>
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
                        {task.action_category ? <span className="rounded bg-cui-light px-1.5 text-[10px] font-semibold text-cui-muted">{task.action_category === 'reply' ? 'Message' : task.action_category === 'service' ? 'Service request' : task.action_category === 'approval' ? 'Approval' : 'Delivery issue'}</span> : null}
                        <p className="truncate text-sm font-semibold text-cui-text">{task.subject}</p>
                      </div>
                      {task.description ? <p className="truncate text-xs text-cui-muted">{task.description}</p> : null}
                      {task.assignee ? <p className="text-xs text-cui-muted">{task.assignee}</p> : null}
                      <p className="text-xs text-cui-muted md:hidden">{dueLabel(task.due_date) || 'No due date'}</p>
                    </div>

                    {task.related_name || task.action_href ? (
                      <button
                        type="button"
                        onClick={() => void openRecord(task)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cui-primary/30 bg-cui-primary/5 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/15"
                        title={`Open ${task.related_name || 'request'}`}
                      >
                        <User className="h-3 w-3" />
                        <span className="max-w-36 truncate">Open {task.related_name || 'request'}</span>
                      </button>
                    ) : null}

                    <span className="hidden shrink-0 items-center gap-1 text-xs text-cui-muted md:inline-flex">
                      <Clock className="h-3.5 w-3.5" />
                      {dueLabel(task.due_date) || 'No due date'}
                    </span>

                    <button aria-label={`Reassign ${task.subject}`} disabled={busyId !== null} onClick={() => setAssignment({ id: task.id, name: task.assignee || '' })} className="text-xs font-semibold text-cui-primary">Reassign</button>
                    <TaskSnooze subject={task.subject} disabled={busyId === task.id} onSave={(iso) => updateTask(task.id, { due_date: iso })} />
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
                  {task.related_name || task.action_href ? (
                    <button
                      type="button"
                      onClick={() => void openRecord(task)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cui-primary/30 bg-cui-primary/5 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/15"
                      title={`Open ${task.related_name || 'request'}`}
                    >
                      <User className="h-3 w-3" />
                      <span className="max-w-36 truncate">Open {task.related_name || 'request'}</span>
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
