"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

type TaskStatusFilter = 'all' | 'open' | 'completed' | 'overdue';
type TaskSort = 'due_asc' | 'due_desc' | 'priority' | 'created_desc';
type TaskPriority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  subject: string;
  description?: string | null;
  due_date?: string | null;
  status?: string | null;
  priority?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  created_at: string;
}

interface NewTaskForm {
  subject: string;
  description: string;
  due_date: string;
  priority: TaskPriority;
  status: 'open';
  related_type: string;
  related_id: string;
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  if ((task.status ?? 'open') === 'completed') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date);
  due.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function priorityBadge(priority: string | null | undefined): string {
  const value = (priority ?? 'medium').toLowerCase();
  if (value === 'high') return 'bg-rose-100 text-rose-700';
  if (value === 'low') return 'bg-emerald-100 text-emerald-700';
  return 'bg-amber-100 text-amber-700';
}

export default function TasksPage(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all');
  const [sort, setSort] = useState<TaskSort>('due_asc');
  const [newTask, setNewTask] = useState<NewTaskForm>({
    subject: '',
    description: '',
    due_date: '',
    priority: 'medium',
    status: 'open',
    related_type: '',
    related_id: '',
  });

  const fetchTasks = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({ status: statusFilter, sort }).toString();
    const res = await fetch(`/api/tasks?${query}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load tasks.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Task[];
    setTasks(data);
    setLoading(false);
  };

  useEffect(() => {
    void fetchTasks();
  }, [statusFilter, sort]);

  const handleCreateTask = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create task.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create task.');
      setIsSaving(false);
      return;
    }

    setNewTask({
      subject: '',
      description: '',
      due_date: '',
      priority: 'medium',
      status: 'open',
      related_type: '',
      related_id: '',
    });
    setShowNewTask(false);
    setIsSaving(false);
    await fetchTasks();
  };

  const toggleTaskStatus = async (task: Task): Promise<void> => {
    const nextStatus = (task.status ?? 'open') === 'completed' ? 'open' : 'completed';
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: nextStatus }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update task.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update task.');
      return;
    }

    await fetchTasks();
  };

  const totalOpen = tasks.filter((task) => (task.status ?? 'open') === 'open').length;
  const totalCompleted = tasks.filter((task) => (task.status ?? 'open') === 'completed').length;
  const totalOverdue = tasks.filter((task) => isOverdue(task)).length;

  return (
    <SectionLayout title="Tasks">
      <div className="mb-4 rounded-2xl border border-[#d6deea] bg-gradient-to-r from-[#f5f9ff] via-white to-[#f4f6ff] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#54739e]">Productivity Center</p>
            <h2 className="mt-1 text-xl font-semibold text-[#10273f]">Agency Tasks</h2>
            <p className="mt-1 text-sm text-[#5f738c]">Track work by priority, due date, and related record.</p>
          </div>

          <button
            type="button"
            onClick={() => setShowNewTask(true)}
            className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-[#0b4f92]"
          >
            + New Task
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-xl bg-[#e9f4ff] px-3 py-2 text-sm font-semibold text-[#0e4f8b]">Open {totalOpen}</div>
          <div className="rounded-xl bg-[#eaf8ef] px-3 py-2 text-sm font-semibold text-[#1e7a49]">Completed {totalCompleted}</div>
          <div className="rounded-xl bg-[#fff2e2] px-3 py-2 text-sm font-semibold text-[#8d4f0f]">Overdue {totalOverdue}</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[#d6deea] bg-white px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatusFilter)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>

        <select
          className="rounded border border-[#d6deea] bg-white px-3 py-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as TaskSort)}
        >
          <option value="due_asc">Due Date (Soonest)</option>
          <option value="due_desc">Due Date (Latest)</option>
          <option value="priority">Priority</option>
          <option value="created_desc">Newest</option>
        </select>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#60748a]">Loading tasks...</div> : null}

      {!loading ? (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <div className="rounded-xl border border-[#d6deea] bg-white p-4 text-sm text-[#60748a]">No tasks found for this filter.</div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce6f3] bg-white p-3 shadow-sm transition hover:border-[#c4d7ef]"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={(task.status ?? 'open') === 'completed'}
                    onChange={() => void toggleTaskStatus(task)}
                    className="mt-1 h-4 w-4 rounded border-[#a9b8cc]"
                  />

                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${(task.status ?? 'open') === 'completed' ? 'text-[#7e8b9b] line-through' : 'text-[#10273f]'}`}>
                      {task.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-[#647b94]">
                      Due: {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                      {task.related_type ? ` · Related: ${task.related_type}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isOverdue(task) ? <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-semibold text-rose-700">Overdue</span> : null}
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${priorityBadge(task.priority)}`}>
                    {task.priority ?? 'medium'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${(task.status ?? 'open') === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}
                  >
                    {task.status ?? 'open'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {showNewTask ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-[#10273f]">New Task</h3>

            <form onSubmit={handleCreateTask} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Task title"
                value={newTask.subject}
                onChange={(e) => setNewTask((prev) => ({ ...prev, subject: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />

              <textarea
                placeholder="Description"
                value={newTask.description}
                onChange={(e) => setNewTask((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />

              <input
                type="date"
                value={newTask.due_date}
                onChange={(e) => setNewTask((prev) => ({ ...prev, due_date: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />

              <select
                value={newTask.priority}
                onChange={(e) => setNewTask((prev) => ({ ...prev, priority: e.target.value as TaskPriority }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>

              <select
                value={newTask.related_type}
                onChange={(e) => setNewTask((prev) => ({ ...prev, related_type: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              >
                <option value="">Related Type (Optional)</option>
                <option value="lead">Lead</option>
                <option value="client">Client</option>
                <option value="policy">Policy</option>
                <option value="claim">Claim</option>
                <option value="endorsement">Endorsement</option>
                <option value="certificate">Certificate</option>
              </select>

              <input
                type="text"
                placeholder="Related ID (Optional)"
                value={newTask.related_id}
                onChange={(e) => setNewTask((prev) => ({ ...prev, related_id: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded bg-[#0f63b4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b4f92] disabled:opacity-60"
              >
                {isSaving ? 'Saving Task...' : 'Save Task'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewTask(false)}
                className="w-full rounded bg-[#e7edf5] px-3 py-2 text-sm font-semibold text-[#3d4f65] hover:bg-[#d8e1ec]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
