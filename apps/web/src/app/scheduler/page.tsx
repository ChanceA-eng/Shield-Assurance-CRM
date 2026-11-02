'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventDropArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import RecordPicker from '../../components/crm/RecordPicker';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import { calendarDate } from '../../lib/calendar-event';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import type { Route } from 'next';
import * as Dialog from '@radix-ui/react-dialog';
import { useNotifications } from '../../context/NotificationContext';

interface CalendarEvent {
  id: string; subject: string; title?: string; description: string | null;
  event_date: string; event_time: string | null; all_day: boolean;
  status: 'scheduled' | 'completed'; related_type: string | null; related_id: string | null;
  client_id?: string | null; updated_at?: string;
}
interface DayTask { id: string; subject: string; due_date: string | null; related_href?: string | null }
interface EventForm { id: string; title: string; description: string; event_date: string; event_time: string; all_day: boolean; related_type: '' | 'lead' | 'client'; related_id: string }
const inputClass = 'w-full rounded border border-cui-border px-3 py-2 text-sm';
const buttonClass = 'rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';

function newForm(): EventForm {
  return { id: crypto.randomUUID(), title: '', description: '', event_date: calendarDate(), event_time: '09:00', all_day: false, related_type: '', related_id: '' };
}

function Scheduler(): JSX.Element {
  const params = useSearchParams();
  const list = params.get('view') === 'list';
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<DayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<EventForm | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [status, setStatus] = useState('all');
  const calendar = useRef<FullCalendar>(null);
  const openedLink = useRef<string | null>(null);
  const eventParam = params.get('event');
  const { refresh: refreshNotifications } = useNotifications();
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [rows, dayTasks] = await Promise.all([
        workspacePages<CalendarEvent>('/api/events?status=all&order=asc', 200, 'offset'),
        workspacePages<DayTask>('/api/tasks?status=open&due=today&sort=due_asc&include=related&limit=200', 200, 'offset'),
      ]);
      setEvents(rows); setTasks(dayTasks); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load calendar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback((event: CalendarEvent): void => {
    setEditing(event);
    setForm({
      id: event.id, title: event.title || event.subject, description: event.description || '',
      event_date: event.event_date.slice(0, 10), event_time: event.event_time?.slice(0, 5) || '09:00', all_day: event.all_day,
      related_type: event.related_type === 'lead' ? 'lead' : event.client_id ? 'client' : '',
      related_id: event.related_type === 'lead' ? event.related_id || '' : event.client_id || '',
    });
  }, []);
  useEffect(() => {
    const id = eventParam;
    if (!id) { openedLink.current = null; return; }
    if (loading || openedLink.current === id) return;
    const event = events.find((row) => row.id === id);
    if (event) { openedLink.current = id; open(event); calendar.current?.getApi().gotoDate(event.event_date); }
    else if (!error) { openedLink.current = id; setError('This appointment was not found. Refresh the calendar or return to Tasks.'); }
  }, [eventParam, loading, events, error, open]);
  const visible = useMemo(() => events.filter((event) => status === 'all' || event.status === status), [events, status]);
  async function save(id: string, changes: Record<string, unknown>, create = false): Promise<boolean> {
    setBusy(true); setError('');
    try {
      await workspaceFetch('/api/events', {
        method: create ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changes, id, expected_updated_at: create ? undefined : events.find((event) => event.id === id)?.updated_at }),
      });
      await load(); await refreshNotifications(); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save appointment.'); return false; }
    finally { setBusy(false); }
  }
  function dateClick(arg: DateClickArg): void {
    setEditing(null); setError('');
    setForm({ ...newForm(), event_date: arg.dateStr.slice(0, 10), event_time: arg.dateStr.slice(11, 16) || '09:00', all_day: arg.allDay });
  }
  async function drop(arg: EventDropArg): Promise<void> {
    // FullCalendar's UTC mode represents wall-clock Arizona fields without browser-zone conversion.
    const start = arg.event.start;
    if (!start) { arg.revert(); setError('The new appointment time is invalid.'); return; }
    const ok = await save(arg.event.id, { event_date: start.toISOString().slice(0, 10), event_time: arg.event.allDay ? null : start.toISOString().slice(11, 16), all_day: arg.event.allDay });
    if (!ok) arg.revert();
  }
  return <SectionLayout title="Calendar & Events">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cui-border bg-white p-5 shadow-card">
      <div><p className="text-xs font-bold uppercase tracking-wider text-cui-primary">Your appointment center</p><h2 className="mt-1 text-xl font-semibold text-cui-text">One calendar. One connected task.</h2><p className="mt-2 text-sm text-cui-muted">All times are Arizona (AZ). Rescheduling updates the linked task; completing either updates both. No email is sent automatically.</p></div>
      <div className="flex gap-2">
        <Link href={list ? '/scheduler' : '/scheduler?view=list'} className="rounded border border-cui-border px-3 py-2 text-sm font-semibold text-cui-primary">{list ? 'Calendar view' : 'List view'}</Link>
        <button className={buttonClass} onClick={() => { setEditing(null); setError(''); setForm(newForm()); }}>+ New Event</button>
      </div>
    </div>
    {error ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button disabled={loading || busy} onClick={() => void load()} className="font-semibold underline">Refresh calendar</button></div> : null}
    {loading ? <p className="mb-3 text-sm text-cui-muted">Loading calendar...</p> : null}
    <div className="mb-4 flex items-center gap-3"><label htmlFor="event-status" className="text-sm font-semibold">Show</label><select id="event-status" className="rounded border border-cui-border bg-white p-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All appointments</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option></select></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <Card><CardBody>
        {list ? <div className="space-y-3">
          {visible.map((event) => <article key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cui-border p-3">
            <div><button onClick={() => open(event)} className="text-left text-sm font-semibold text-cui-primary hover:underline">{event.title || event.subject}</button><p className="mt-1 text-xs text-cui-muted">{event.event_date.slice(0, 10)} - {event.all_day ? 'All day' : `${event.event_time?.slice(0, 5)} AZ`} - {event.status}</p></div>
            <button disabled={busy} onClick={() => void save(event.id, { status: event.status === 'completed' ? 'scheduled' : 'completed' })} className="rounded border border-cui-border px-3 py-1.5 text-xs font-semibold text-cui-primary disabled:opacity-50">{event.status === 'completed' ? 'Reopen' : 'Complete'}</button>
          </article>)}
          {!loading && !visible.length ? <p className="text-sm text-cui-muted">No appointments in this view.</p> : null}
        </div> : <FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} timeZone="UTC" initialView="dayGridMonth" headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }} events={visible.map((event) => ({ id: event.id, title: event.title || event.subject, start: event.all_day ? event.event_date.slice(0, 10) : `${event.event_date.slice(0, 10)}T${event.event_time?.slice(0, 5) || '09:00'}`, allDay: event.all_day, backgroundColor: event.status === 'completed' ? '#4dbd74' : '#20a8d8', borderColor: event.status === 'completed' ? '#4dbd74' : '#20a8d8' }))} editable={!busy} eventDurationEditable={false} selectable dateClick={dateClick} eventClick={(arg) => { const event = events.find((row) => row.id === arg.event.id); if (event) open(event); }} eventDrop={(arg) => void drop(arg)} />}
      </CardBody></Card>
      <div className="space-y-5">
        <Card><CardHeader>Today in Arizona</CardHeader><CardBody><div className="space-y-3">{events.filter((event) => event.event_date.slice(0, 10) === calendarDate()).map((event) => <div key={event.id} className="border-b border-cui-border pb-3"><button onClick={() => open(event)} className="text-left text-sm font-semibold text-cui-primary">{event.title || event.subject}</button><p className="mt-1 text-xs text-cui-muted">{event.all_day ? 'All day' : `${event.event_time?.slice(0, 5)} AZ`} - {event.status}</p></div>)}{!loading && !events.some((event) => event.event_date.slice(0, 10) === calendarDate()) ? <p className="text-sm text-cui-muted">No appointments today.</p> : null}</div></CardBody></Card>
        <Card><CardHeader>Tasks due today or overdue</CardHeader><CardBody><div className="space-y-3">{tasks.map((task) => <div key={task.id} className="border-b border-cui-border pb-3"><Link href={(task.related_href || '/tasks') as Route} className="text-sm font-semibold text-cui-primary">{task.subject}</Link><p className="mt-1 text-xs text-cui-muted">{formatArizonaDateTime(task.due_date)} AZ</p></div>)}{!loading && !tasks.length ? <p className="text-sm text-cui-muted">No open tasks due today.</p> : null}<Link href="/tasks" className="inline-block text-sm font-semibold text-cui-primary">Open Tasks</Link></div></CardBody></Card>
      </div>
    </div>
    {form ? <Dialog.Root open onOpenChange={(opened) => { if (!opened && !busy) setForm(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()} className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
      <Dialog.Title className="mb-2 text-lg font-semibold">{editing ? 'Edit Event' : 'New Event'}</Dialog.Title>
      <Dialog.Description className="mb-4 text-sm text-cui-muted">Save an Arizona appointment and its connected task together.</Dialog.Description>
      {error ? <p role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p> : null}
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(form.id, { subject: form.title, title: form.title, description: form.description, event_date: form.event_date, event_time: form.all_day ? null : form.event_time, all_day: form.all_day, related_type: form.related_type || null, related_id: form.related_id || null, client_id: form.related_type === 'client' ? form.related_id : null }, !editing).then((ok) => { if (ok) setForm(null); }); }}>
        <label className="block text-sm font-semibold">Event title<input autoFocus required maxLength={240} className={`${inputClass} mt-1 font-normal`} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="block text-sm font-semibold">Description<textarea className={`${inputClass} mt-1 font-normal`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="block text-sm font-semibold">Date<input required type="date" className={`${inputClass} mt-1 font-normal`} value={form.event_date} onChange={(event) => setForm({ ...form, event_date: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked })} />All-day event (task due 9 AM AZ)</label>
        {!form.all_day ? <label className="block text-sm font-semibold">Time (Arizona)<input required type="time" className={`${inputClass} mt-1 font-normal`} value={form.event_time} onChange={(event) => setForm({ ...form, event_time: event.target.value })} /></label> : null}
        <label className="block text-sm font-semibold">Link to<select aria-label="Link to" className={`${inputClass} mt-1 font-normal`} value={form.related_type} onChange={(event) => setForm({ ...form, related_type: event.target.value === 'lead' ? 'lead' : event.target.value === 'client' ? 'client' : '', related_id: '' })}><option value="">Standalone appointment</option><option value="lead">Lead</option><option value="client">Account</option></select></label>
        {form.related_type ? <RecordPicker type={form.related_type} value={form.related_id} onChange={(id) => setForm({ ...form, related_id: id })} /> : null}
        <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={busy} onClick={() => setForm(null)} className="rounded border border-cui-border px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Saving...' : editing ? 'Update Event' : 'Save Event'}</button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root> : null}
  </SectionLayout>;
}

export default function SchedulerPage(): JSX.Element {
  return <Suspense fallback={<SectionLayout title="Calendar & Events"><p>Loading calendar...</p></SectionLayout>}><Scheduler /></Suspense>;
}
