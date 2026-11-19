'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, Circle, Clock, Filter, Flag, Plus, User, X } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import LeadWorkspace, { type WorkspaceLead } from '../leads/LeadWorkspace';
import { addAgencyDays, agencyDateTimeInput, DEFAULT_AGENCY_TIME_ZONE, formatAgencyDateTime, type AgencyTimeZone } from '../../lib/agency-time';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import TaskSnooze from '../../components/crm/TaskSnooze';
import { useNotifications } from '../../context/NotificationContext';
import { taskRecordHref } from '../../lib/task-links';
import { TaskCreateDialog, TaskReassignDialog, TaskRescheduleDialog } from '../../components/crm/TaskDialogs';
import { watchConversationUpdates } from '../../lib/conversation-updates';
import { useAgencyTimeZone } from '../../hooks/useAgencyTimeZone';
import { useWorkspaceNavigation } from '../../context/WorkspaceNavigationContext';

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

function bucketize(tasks: Task[], timeZone: AgencyTimeZone): Bucket[] {
  const now = new Date();
  const today = agencyDateTimeInput(now, timeZone).slice(0, 10);
  const tomorrow = addAgencyDays(today, 1, timeZone);
  const week = addAgencyDays(today, 7, timeZone);

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
    const due = new Date(task.due_date);
    const dueDate = agencyDateTimeInput(due, timeZone).slice(0, 10);
    if (due.getTime() < now.getTime()) buckets[0].tasks.push(task);
    else if (dueDate === today) buckets[1].tasks.push(task);
    else if (dueDate === tomorrow) buckets[2].tasks.push(task);
    else if (dueDate <= week) buckets[3].tasks.push(task);
    else buckets[4].tasks.push(task);
  }

  return buckets.filter((bucket) => bucket.tasks.length > 0);
}

function dueLabel(value: string | null | undefined, timeZone: AgencyTimeZone): string {
  if (!value) return '';
  return formatAgencyDateTime(value, timeZone);
}

export default function TasksPage(): JSX.Element {
  const { navigate } = useWorkspaceNavigation();
  const { refresh } = useNotifications();
  const agency = useAgencyTimeZone();
  const timeZone = agency.timeZone ?? DEFAULT_AGENCY_TIME_ZONE;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [view, setView] = useState<'open' | 'completed'>('open');
  const [completed, setCompleted] = useState<Task[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerLead, setDrawerLead] = useState<WorkspaceLead | null>(null);
  const [assignment, setAssignment] = useState<{ id: string; name: string; subject: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [filterDate, setFilterDate] = useState('');
  const [filterTime, setFilterTime] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const newTaskRef = useRef<HTMLButtonElement>(null);
  const closeCreate = (): void => {
    setCreating(false);
    window.setTimeout(() => newTaskRef.current?.focus(), 30);
  };

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const closeOutside = (event: MouseEvent): void => {
      if (filterRef.current && event.target instanceof Node && !filterRef.current.contains(event.target)) setFiltersOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [filtersOpen]);

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
      setError(failure instanceof Error ? failure.message : 'We could not reach the CRM. Check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    return watchConversationUpdates(fetchTasks);
  }, [fetchTasks]);
  useEffect(() => {
    if (agency.error) setError(agency.error);
  }, [agency.error]);

  const scoped = useMemo(() => {
    return tasks.filter((task) => {
      const matchesScope = scope === 'all' || (scope === 'none' ? !task.related_type
        : scope === 'client' ? task.related_type === 'client' || Boolean(task.account_id) : task.related_type === scope);
      const due = task.due_date ? agencyDateTimeInput(task.due_date, timeZone) : '';
      return matchesScope && (!filterDate || due.slice(0, 10) === filterDate) && (!filterTime || due.slice(11, 16) === filterTime);
    });
  }, [tasks, scope, filterDate, filterTime, timeZone]);

  useEffect(() => { setSelected({}); setBulkNotice(''); }, [scope, view, filterDate, filterTime]);
  const selectedCount = Object.keys(selected).length;
  const toggleSelection = (task: Task): void => {
    const version = task.updated_at;
    if (!version) { setError('This task has no saved version. Refresh tasks before selecting it.'); return; }
    setBulkNotice('');
    setSelected((current) => {
      const next = { ...current };
      if (next[task.id]) delete next[task.id];
      else if (Object.keys(next).length < 200) next[task.id] = version;
      return next;
    });
  };
  const bulkReschedule = async (due: string): Promise<string | null> => {
    if (bulkBusy || busyId || selectedCount === 0) return 'Wait for the current update to finish.';
    if (!agency.timeZone) return agency.error ?? 'Agency time zone is still loading.';
    setBulkBusy(true); setError(null); setBulkNotice('');
    try {
      const result = await workspaceFetch<{ updated: number }>('/api/tasks/bulk-reschedule', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: Object.entries(selected).map(([id, expected_updated_at]) => ({ id, expected_updated_at })), due_date: due }),
      });
      setSelected({});
      setBulkNotice(`${result.updated} tasks rescheduled to ${formatAgencyDateTime(due, timeZone)}.`);
      await Promise.all([fetchTasks(), refresh()]);
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'Bulk rescheduling could not be verified. Refresh before retrying.';
    } finally { setBulkBusy(false); }
  };

  const buckets = useMemo(() => bucketize(scoped, timeZone), [scoped, timeZone]);

  const patchTask = async (taskId: string, patch: Record<string, unknown>): Promise<string | null> => {
    if (bulkBusy) return 'Wait for the current update to finish.';
    const task = [...tasks, ...completed].find((row) => row.id === taskId);
    if (!task) return 'This task is no longer on the current list. Refresh before retrying.';
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
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'Unable to update this task.';
    } finally {
      setBusyId(null);
    }
  };
  const updateTask = async (taskId: string, patch: Record<string, unknown>): Promise<boolean> => {
    const failure = await patchTask(taskId, patch);
    if (failure) setError(failure);
    return !failure;
  };
  const taskCreated = async (): Promise<void> => {
    await fetchTasks();
    await refresh();
  };

  const openRecord = async (task: Task): Promise<void> => {
    if (task.action_href) {
      const href = taskRecordHref(task);
      if (href) { navigate(href); return; }
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
    if (href && task.related_type !== 'lead') navigate(href);
    else if (task.related_type !== 'lead') setError('This task has no available linked record. Open its profile or repair the relationship before retrying.');
  };

  const openCount = scoped.length;

  return (
    <SectionLayout title="Tasks">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-cui-border bg-cui-panel p-2 shadow-card">
        <button ref={newTaskRef} type="button" onClick={() => setCreating(true)} disabled={!agency.timeZone} className="crm-button-primary">
          <Plus className="h-4 w-4" />New task
        </button>
        <div className="crm-tabs border-0 p-0 shadow-none" aria-label="Task status">
          <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')} className="crm-tab">Open ({tasks.length})</button>
          <button type="button" aria-pressed={view === 'completed'} onClick={() => setView('completed')} className="crm-tab">Completed ({completed.length})</button>
        </div>
        {view === 'open' ? (
          <>
            <span className="hidden h-6 w-px bg-cui-border sm:block" aria-hidden="true" />
            <div className="flex flex-wrap gap-1" aria-label="Task scope">
              {([
                ['all', `All (${tasks.length})`],
                ['lead', `Leads (${tasks.filter((t) => t.related_type === 'lead').length})`],
                ['client', `Accounts (${tasks.filter((t) => t.related_type === 'client' || Boolean(t.account_id)).length})`],
                ['none', `Unlinked (${tasks.filter((t) => !t.related_type).length})`],
              ] as Array<[Scope, string]>).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${scope === key ? 'bg-cui-primary-strong text-white' : 'text-cui-muted hover:bg-cui-light hover:text-cui-text'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div ref={filterRef} className="relative">
                <button type="button" aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={() => setFiltersOpen((open) => !open)}
                  className={`crm-button min-h-8 px-2.5 py-1.5 text-xs ${filterDate || filterTime ? 'border-cui-primary text-cui-primary' : ''}`}>
                  <Filter className="h-3.5 w-3.5" />Due filter{filterDate || filterTime ? ` (${[filterDate, filterTime].filter(Boolean).length})` : ''}
                </button>
                {filtersOpen ? (
                  <div role="dialog" aria-label="Due filter" className="absolute right-0 z-30 mt-2 w-64 space-y-3 rounded-xl border border-cui-border bg-cui-panel p-3 shadow-panel">
                    <label className="block text-xs font-semibold text-cui-muted">Current due date
                      <input aria-label="Filter current due date" type="date" disabled={bulkBusy} value={filterDate} onChange={(event) => setFilterDate(event.target.value)} className="crm-input mt-1" />
                    </label>
                    <label className="block text-xs font-semibold text-cui-muted">Current due time
                      <input aria-label="Filter current due time" type="time" disabled={bulkBusy} value={filterTime} onChange={(event) => setFilterTime(event.target.value)} className="crm-input mt-1" />
                    </label>
                    <div className="flex justify-between gap-2">
                      <button type="button" disabled={bulkBusy || (!filterDate && !filterTime)} onClick={() => { setFilterDate(''); setFilterTime(''); }} className="crm-button min-h-8 px-2.5 py-1 text-xs">Clear due filters</button>
                      <button type="button" onClick={() => setFiltersOpen(false)} className="crm-button-primary min-h-8 px-2.5 py-1 text-xs">Done</button>
                    </div>
                  </div>
                ) : null}
              </div>
              <label className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold text-cui-muted hover:bg-cui-light">
                <input type="checkbox" aria-label="Select all filtered open tasks" className="h-4 w-4"
                  disabled={bulkBusy || loading || scoped.length === 0 || scoped.length > 200 || scoped.some((task) => !task.updated_at)}
                  checked={scoped.length > 0 && scoped.every((task) => Boolean(selected[task.id]))}
                  onChange={(event) => {
                    setBulkNotice('');
                    setSelected(event.target.checked ? Object.fromEntries(scoped.flatMap((task) => task.updated_at ? [[task.id, task.updated_at]] : [])) : {});
                  }} />
                Select all{scoped.length > 200 ? ' (max 200)' : ''}
              </label>
            </div>
          </>
        ) : null}
      </div>
      {bulkNotice ? <p role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{bulkNotice}</p> : null}
      {error ? <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error} <button type="button" onClick={() => void fetchTasks()} className="font-semibold underline">Refresh tasks</button></div> : null}
      {loading ? <p className="text-sm text-cui-muted">Loading tasks…</p> : null}

      {!loading && view === 'open' && openCount === 0 ? (
        <div className="rounded-lg border border-dashed border-cui-border bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cui-success" />
          <p className="mt-2 text-sm font-semibold text-cui-text">No saved tasks</p>
          <p className="text-xs text-cui-muted">No open tasks in this view.</p>
        </div>
      ) : null}

      {!loading && view === 'completed' && completed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cui-border bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-cui-muted" />
          <p className="mt-2 text-sm font-semibold text-cui-text">Nothing completed yet</p>
          <p className="text-xs text-cui-muted">Finished tasks land here — with a Reopen button in case one gets checked off by accident.</p>
        </div>
      ) : null}

      {/* Buckets */}
      <div className={`space-y-5 ${view === 'open' && selectedCount > 0 ? 'pb-36 md:pb-24' : ''}`}>
        {view === 'open'
          ? buckets.map((bucket) => (
          <section key={bucket.key}>
            <h2 className={`mb-2 text-sm font-bold uppercase tracking-wide ${bucket.tone}`}>
              {bucket.label} <span className="font-normal opacity-70">({bucket.tasks.length})</span>
            </h2>
            <div className="divide-y divide-cui-light rounded-lg border border-cui-border/60 bg-white shadow-card">
              {bucket.tasks.map((task) => {
                const isHigh = (task.priority ?? '').toLowerCase() === 'high';
                return (
                  <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" aria-label={`Select ${task.subject}`} checked={Boolean(selected[task.id])} disabled={bulkBusy || (selectedCount >= 200 && !selected[task.id])} onChange={() => toggleSelection(task)} className="h-4 w-4 shrink-0" />
                    <button
                      type="button"
                      onClick={() => void updateTask(task.id, { status: 'completed' })}
                      disabled={bulkBusy || busyId === task.id}
                      className="shrink-0 text-cui-muted transition hover:text-cui-success disabled:opacity-50"
                      title="Mark complete"
                      aria-label={`Complete ${task.subject}`}
                    >
                      <Circle className="h-5 w-5" />
                    </button>

                    <div className="min-w-0 flex-[1_1_12rem]">
                      <div className="flex items-center gap-2">
                        {isHigh ? <Flag className="h-3.5 w-3.5 shrink-0 text-cui-danger" /> : null}
                        {task.kind === 'reminder' ? <span className="rounded-lg bg-cui-primary/10 px-1.5 text-[10px] font-semibold text-cui-primary">Reminder</span> : null}
                        {task.action_category ? <span className="rounded-lg bg-cui-light px-1.5 text-[10px] font-semibold text-cui-muted">{task.action_category === 'reply' ? 'Message' : task.action_category === 'service' ? 'Service request' : task.action_category === 'approval' ? 'Approval' : 'Delivery issue'}</span> : null}
                        {task.related_href || taskRecordHref(task) ? <button type="button" onClick={() => void openRecord(task)}
                          className="truncate text-left text-sm font-semibold text-cui-primary hover:underline">{task.subject}</button>
                          : <p className="truncate text-sm font-semibold text-cui-text">{task.subject}</p>}
                      </div>
                      {task.description ? <p className="truncate text-xs text-cui-muted">{task.description}</p> : null}
                      {task.assignee ? <p className="text-xs text-cui-muted">{task.assignee}</p> : null}
                      <p className="text-xs text-cui-muted md:hidden">{dueLabel(task.due_date, timeZone) || 'No due date'}</p>
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
                      {dueLabel(task.due_date, timeZone) || 'No due date'}
                    </span>

                    <button type="button" aria-label={`Reassign ${task.subject}`} disabled={bulkBusy || busyId !== null} onClick={() => setAssignment({ id: task.id, name: task.assignee || '', subject: task.subject })} className="text-xs font-semibold text-cui-primary">Reassign</button>
                    <TaskSnooze subject={task.subject} timeZone={agency.timeZone ?? undefined} disabled={bulkBusy || busyId === task.id} onSave={(iso) => updateTask(task.id, { due_date: iso })} />
                  </div>
                );
              })}
            </div>
          </section>
          ))
          : null}

        {view === 'completed' && completed.length > 0 ? (
          <section>
            <div className="divide-y divide-cui-light rounded-lg border border-cui-border/60 bg-white shadow-card">
              {completed.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-cui-success" />
                  <div className="min-w-0 flex-[1_1_12rem]">
                    {task.related_href || taskRecordHref(task) ? <button type="button" onClick={() => void openRecord(task)}
                      className="truncate text-left text-sm text-cui-primary line-through hover:underline">{task.subject}</button>
                      : <p className="truncate text-sm text-cui-muted line-through">{task.subject}</p>}
                    {task.description ? <p className="truncate text-xs text-cui-muted/70">{task.description}</p> : null}
                    <p className="text-xs text-cui-muted md:hidden">{dueLabel(task.due_date, timeZone) || 'No due date'}</p>
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
                    {dueLabel(task.due_date, timeZone) || 'No due date'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void updateTask(task.id, { status: 'open' })}
                    disabled={busyId === task.id}
                    aria-label={`Reopen ${task.subject}`}
                    className="shrink-0 rounded-lg border border-cui-primary/40 px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/10 disabled:opacity-50"
                  >
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {view === 'open' && selectedCount > 0 ? (
        <section aria-label="Selected tasks" className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-center gap-2 rounded-xl border border-cui-border bg-cui-panel px-3 py-2 shadow-panel md:bottom-4">
          <span className="text-sm font-semibold text-cui-text">{selectedCount} selected</span>
          <span className="flex-1" />
          <button type="button" disabled={bulkBusy || busyId !== null || !agency.timeZone} onClick={() => setRescheduling(true)} className="crm-button-primary min-h-8 px-3 py-1.5 text-xs">
            <CalendarClock className="h-3.5 w-3.5" />Reschedule
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => setSelected({})} aria-label="Clear selection" className="rounded-lg p-2 text-cui-muted hover:bg-cui-light disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </section>
      ) : null}

      {creating ? <TaskCreateDialog timeZone={timeZone} ready={Boolean(agency.timeZone)} onClose={closeCreate} onCreated={taskCreated} /> : null}
      {rescheduling && selectedCount > 0 ? <TaskRescheduleDialog count={selectedCount} timeZone={timeZone} ready={Boolean(agency.timeZone)} onClose={() => setRescheduling(false)} onSubmit={bulkReschedule} /> : null}
      {assignment ? <TaskReassignDialog subject={assignment.subject} initial={assignment.name} onClose={() => setAssignment(null)}
        onSubmit={(name) => patchTask(assignment.id, { assignee: name || null })} /> : null}

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
