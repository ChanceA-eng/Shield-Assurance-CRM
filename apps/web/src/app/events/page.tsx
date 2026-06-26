"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';

interface EventItem {
  id: string;
  subject?: string;
  title?: string;
  description?: string | null;
  event_date: string;
  event_time?: string | null;
  all_day?: boolean | null;
  status?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  task_id?: string | null;
}

interface NewEventForm {
  title: string;
  description: string;
  event_date: string;
  event_time: string;
  all_day: boolean;
  status: 'scheduled';
  related_type: string;
  related_id: string;
}

type EventStatusFilter = 'all' | 'scheduled' | 'completed';

function formatDateTime(event: EventItem): string {
  const date = new Date(event.event_date);
  if (Number.isNaN(date.getTime())) return event.event_date;
  const datePart = date.toLocaleDateString();
  if (event.all_day) return `${datePart} · All day`;
  if (event.event_time) return `${datePart} · ${event.event_time}`;
  return `${datePart} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function normalizedStatus(event: EventItem): string {
  return event.status ?? 'scheduled';
}

function nowISOForInput(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function EventsPage(): JSX.Element {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('all');
  const [newEvent, setNewEvent] = useState<NewEventForm>({
    title: '',
    description: '',
    event_date: todayISO(),
    event_time: nowISOForInput().slice(11, 16),
    all_day: false,
    status: 'scheduled',
    related_type: '',
    related_id: '',
  });

  const fetchEvents = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({ status: statusFilter, order: 'asc' }).toString();
    const res = await fetch(`/api/events?${query}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load events.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as EventItem[];
    setEvents(data);
    setLoading(false);
  };

  useEffect(() => {
    void fetchEvents();
  }, [statusFilter]);

  const handleCreateEvent = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const payload = {
      subject: newEvent.title,
      title: newEvent.title,
      description: newEvent.description,
      event_date: newEvent.event_date,
      event_time: newEvent.all_day ? '' : newEvent.event_time,
      all_day: newEvent.all_day,
      status: newEvent.status,
      related_type: newEvent.related_type,
      related_id: newEvent.related_id,
    };

    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to create event.' }))) as { message?: string };
      setError(body.message ?? 'Failed to create event.');
      setIsSaving(false);
      return;
    }

    setShowNewEvent(false);
    setIsSaving(false);
    setNewEvent({
      title: '',
      description: '',
      event_date: todayISO(),
      event_time: nowISOForInput().slice(11, 16),
      all_day: false,
      status: 'scheduled',
      related_type: '',
      related_id: '',
    });
    await fetchEvents();
  };

  const toggleEventStatus = async (event: EventItem): Promise<void> => {
    const nextStatus = (event.status ?? 'scheduled') === 'completed' ? 'scheduled' : 'completed';
    const res = await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, status: nextStatus }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to update event.' }))) as { message?: string };
      setError(body.message ?? 'Failed to update event.');
      return;
    }

    await fetchEvents();
  };

  const scheduledCount = events.filter((event) => normalizedStatus(event) === 'scheduled').length;
  const completedCount = events.filter((event) => normalizedStatus(event) === 'completed').length;

  return (
    <SectionLayout title="Events">
      <div className="mb-4 rounded-2xl border border-[#d6deea] bg-gradient-to-r from-[#f4fbff] via-white to-[#f1fff8] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4b7b6b]">Calendar Center</p>
            <h2 className="mt-1 text-xl font-semibold text-[#10273f]">Agency Events</h2>
            <p className="mt-1 text-sm text-[#5f738c]">Appointments, calls, and follow-ups synced with tasks.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/scheduler"
              className="rounded-full border border-[#c7d6ea] bg-white px-4 py-2 text-xs font-semibold text-[#184168] shadow-sm hover:bg-[#f4f8fd]"
            >
              Open Scheduler
            </Link>
            <button
              type="button"
              onClick={() => setShowNewEvent(true)}
              className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-[#0b4f92]"
            >
              + New Event
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-xl bg-[#e8f4ff] px-3 py-2 text-sm font-semibold text-[#0e4f8b]">Scheduled {scheduledCount}</div>
          <div className="rounded-xl bg-[#eaf8ef] px-3 py-2 text-sm font-semibold text-[#1e7a49]">Completed {completedCount}</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[#d6deea] bg-white px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EventStatusFilter)}
        >
          <option value="all">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#60748a]">Loading events...</div> : null}

      {!loading ? (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="rounded-xl border border-[#dce6f3] bg-white p-4 text-sm text-[#60748a]">No events found for this filter.</div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce6f3] bg-white p-3 shadow-sm transition hover:border-[#c4d7ef]"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={(event.status ?? 'scheduled') === 'completed'}
                    onChange={() => void toggleEventStatus(event)}
                    className="mt-1 h-4 w-4 rounded border-[#a9b8cc]"
                  />

                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${(event.status ?? 'scheduled') === 'completed' ? 'text-[#7e8b9b] line-through' : 'text-[#10273f]'}`}>
                      {event.title ?? event.subject ?? 'Untitled event'}
                    </p>
                    <p className="mt-0.5 text-xs text-[#647b94]">
                      {formatDateTime(event)}
                      {event.related_type ? ` · Related: ${event.related_type}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${event.all_day ? 'bg-indigo-100 text-indigo-700' : 'bg-cyan-100 text-cyan-700'}`}>
                    {event.all_day ? 'all-day' : 'timed'}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${(event.status ?? 'scheduled') === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                    {normalizedStatus(event)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {showNewEvent ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-[#10273f]">New Event</h3>
            <form onSubmit={handleCreateEvent} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Event subject"
                value={newEvent.title}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Description"
                value={newEvent.description}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />
              <input
                required
                type="date"
                value={newEvent.event_date}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, event_date: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm text-[#44576f]">
                <input
                  type="checkbox"
                  checked={newEvent.all_day}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, all_day: e.target.checked }))}
                  className="h-4 w-4 rounded border-[#a9b8cc]"
                />
                All-day event
              </label>
              {!newEvent.all_day ? (
                <input
                  type="time"
                  value={newEvent.event_time}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, event_time: e.target.value }))}
                  className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
                />
              ) : null}
              <select
                value={newEvent.related_type}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, related_type: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              >
                <option value="">Related Type (Optional)</option>
                <option value="lead">Lead</option>
                <option value="client">Client</option>
                <option value="policy">Policy</option>
                <option value="claim">Claim</option>
                <option value="endorsement">Endorsement</option>
                <option value="certificate">Certificate</option>
                <option value="task">Task</option>
              </select>
              <input
                type="text"
                placeholder="Related ID (Optional)"
                value={newEvent.related_id}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, related_id: e.target.value }))}
                className="w-full rounded border border-[#d6deea] px-3 py-2 text-sm"
              />

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded bg-[#0f63b4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b4f92] disabled:opacity-60"
              >
                {isSaving ? 'Saving Event...' : 'Save Event'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewEvent(false)}
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
