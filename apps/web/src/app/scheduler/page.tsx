"use client";

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import React, { useEffect, useMemo, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface DateClickArg {
  dateStr: string;
  allDay: boolean;
}

interface EventClickArg {
  event: {
    id: string;
  };
}

interface EventDropArg {
  event: {
    id: string;
    allDay: boolean;
    start: Date | null;
  };
  revert: () => void;
}

interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
}

interface ApiEvent {
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
}

interface ApiTask {
  id: string;
  subject: string;
  due_date?: string | null;
  status?: string | null;
}

interface NewEventForm {
  title: string;
  description: string;
  event_date: string;
  event_time: string;
  all_day: boolean;
  related_type: string;
  related_id: string;
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeInput(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function eventStart(event: ApiEvent): string {
  const baseDate = event.event_date.slice(0, 10);
  if (event.all_day) return baseDate;
  if (event.event_time) return `${baseDate}T${event.event_time}`;
  return `${baseDate}T09:00`;
}

export default function SchedulerPage(): JSX.Element {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [tasksToday, setTasksToday] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState<NewEventForm>({
    title: '',
    description: '',
    event_date: toDateInput(new Date()),
    event_time: toTimeInput(new Date()),
    all_day: false,
    related_type: '',
    related_id: '',
  });

  const calendarEvents: CalendarEventInput[] = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        title: event.title ?? event.subject ?? 'Untitled Event',
        start: eventStart(event),
        allDay: !!event.all_day,
        backgroundColor: (event.status ?? 'scheduled') === 'completed' ? '#16a34a' : '#2563eb',
        borderColor: (event.status ?? 'scheduled') === 'completed' ? '#15803d' : '#1d4ed8',
      })),
    [events],
  );

  const fetchSchedulerData = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const [eventsRes, tasksRes] = await Promise.all([
      fetch('/api/events?status=all&order=asc', { cache: 'no-store' }),
      fetch('/api/tasks?status=all&due=today&sort=due_asc', { cache: 'no-store' }),
    ]);

    if (!eventsRes.ok) {
      setError('Failed to load calendar events.');
      setLoading(false);
      return;
    }

    const eventsData = (await eventsRes.json()) as ApiEvent[];
    setEvents(eventsData);

    if (tasksRes.ok) {
      const taskData = (await tasksRes.json()) as ApiTask[];
      setTasksToday(taskData);
    }

    setLoading(false);
  };

  useEffect(() => {
    void fetchSchedulerData();
  }, []);

  const resetModal = (): void => {
    setEditingEventId(null);
    setNewEvent({
      title: '',
      description: '',
      event_date: toDateInput(new Date()),
      event_time: toTimeInput(new Date()),
      all_day: false,
      related_type: '',
      related_id: '',
    });
  };

  const handleDateClick = (arg: DateClickArg): void => {
    setEditingEventId(null);
    setNewEvent((prev) => ({
      ...prev,
      event_date: arg.dateStr.slice(0, 10),
      all_day: !!arg.allDay,
    }));
    setShowModal(true);
  };

  const handleEventClick = (arg: EventClickArg): void => {
    const selected = events.find((event) => event.id === arg.event.id);
    if (!selected) return;

    setEditingEventId(selected.id);
    setNewEvent({
      title: selected.title ?? selected.subject ?? '',
      description: selected.description ?? '',
      event_date: selected.event_date.slice(0, 10),
      event_time: selected.event_time ?? toTimeInput(new Date()),
      all_day: !!selected.all_day,
      related_type: selected.related_type ?? '',
      related_id: selected.related_id ?? '',
    });
    setShowModal(true);
  };

  const handleReschedule = async (arg: EventDropArg): Promise<void> => {
    const allDay = arg.event.allDay;
    const start = arg.event.start;
    if (!start) return;

    const event_date = start.toISOString().slice(0, 10);
    const event_time = allDay ? '' : start.toISOString().slice(11, 16);

    const res = await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: arg.event.id, event_date, event_time, all_day: allDay }),
    });

    if (!res.ok) {
      arg.revert();
      const body = (await res.json().catch(() => ({ message: 'Failed to reschedule event.' }))) as { message?: string };
      setError(body.message ?? 'Failed to reschedule event.');
      return;
    }

    await fetchSchedulerData();
  };

  const handleSubmitEvent = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    const payload = {
      id: editingEventId,
      subject: newEvent.title,
      title: newEvent.title,
      description: newEvent.description,
      event_date: newEvent.event_date,
      event_time: newEvent.all_day ? '' : newEvent.event_time,
      all_day: newEvent.all_day,
      related_type: newEvent.related_type,
      related_id: newEvent.related_id,
    };

    const res = await fetch('/api/events', {
      method: editingEventId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to save event.' }))) as { message?: string };
      setError(body.message ?? 'Failed to save event.');
      return;
    }

    setShowModal(false);
    resetModal();
    await fetchSchedulerData();
  };

  const markEventComplete = async (event: ApiEvent): Promise<void> => {
    const nextStatus = (event.status ?? 'scheduled') === 'completed' ? 'scheduled' : 'completed';

    const res = await fetch('/api/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, status: nextStatus }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to update event status.' }))) as { message?: string };
      setError(body.message ?? 'Failed to update event status.');
      return;
    }

    await fetchSchedulerData();
  };

  return (
    <SectionLayout title="Scheduler">
      <div className="mb-4 rounded-2xl border border-[#d6deea] bg-gradient-to-r from-[#f2f8ff] via-white to-[#f4f6ff] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#54739e]">Unified Planner</p>
            <h2 className="mt-1 text-xl font-semibold text-[#10273f]">Month · Week · Day Scheduler</h2>
            <p className="mt-1 text-sm text-[#5f738c]">Events auto-create linked tasks and stay synced when status changes.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetModal();
              setShowModal(true);
            }}
            className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-[#0b4f92]"
          >
            + New Event
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#60748a]">Loading scheduler...</div> : null}

      {!loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-2xl border border-[#dce6f3] bg-white p-3 shadow-sm">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              events={calendarEvents}
              editable
              selectable
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventDrop={(arg) => {
                void handleReschedule(arg);
              }}
            />
          </div>

          <div className="space-y-3">
            <article className="rounded-2xl border border-[#dce6f3] bg-white p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-[#10273f]">Today\'s Schedule</h3>
              <ul className="mt-2 space-y-2 text-xs">
                {events
                  .filter((event) => event.event_date.slice(0, 10) === toDateInput(new Date()))
                  .map((event) => (
                    <li key={event.id} className="rounded-lg border border-[#e8eef7] bg-[#fbfdff] px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-[#14324f]">{event.title ?? event.subject}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void markEventComplete(event);
                          }}
                          className="rounded bg-[#edf4ff] px-2 py-1 text-[10px] font-semibold text-[#3652a4]"
                        >
                          {(event.status ?? 'scheduled') === 'completed' ? 'Reopen' : 'Complete'}
                        </button>
                      </div>
                      <p className="mt-1 text-[#6a7a98]">{event.all_day ? 'All day' : event.event_time || 'Timed'}</p>
                    </li>
                  ))}
                {events.filter((event) => event.event_date.slice(0, 10) === toDateInput(new Date())).length === 0 ? (
                  <li className="text-[#6a7a98]">No events scheduled today.</li>
                ) : null}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-[#10273f]">My Day Tasks</h3>
              <ul className="mt-2 space-y-2 text-xs">
                {tasksToday.map((task) => (
                  <li key={task.id} className="rounded-lg border border-[#e8eef7] bg-[#fbfdff] px-2 py-2">
                    <p className="font-semibold text-[#14324f]">{task.subject}</p>
                    <p className="mt-1 text-[#6a7a98]">{task.due_date || 'No due date'} · {task.status ?? 'open'}</p>
                  </li>
                ))}
                {tasksToday.length === 0 ? <li className="text-[#6a7a98]">No tasks due today.</li> : null}
              </ul>
            </article>
          </div>
        </div>
      ) : null}

      {showModal ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-[#10273f]">{editingEventId ? 'Edit Event' : 'New Event'}</h3>

            <form onSubmit={handleSubmitEvent} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Event title"
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
                className="w-full rounded bg-[#0f63b4] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b4f92]"
              >
                {editingEventId ? 'Update Event' : 'Save Event'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetModal();
                }}
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
