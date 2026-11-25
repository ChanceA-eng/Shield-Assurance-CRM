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
import { DEFAULT_AGENCY_TIME_ZONE, formatAgencyDateTime, type AgencyTimeZone } from '../../lib/agency-time';
import { useAgencyTimeZone } from '../../hooks/useAgencyTimeZone';
import type { Route } from 'next';
import * as Dialog from '@radix-ui/react-dialog';
import { useNotifications } from '../../context/NotificationContext';
import { sendAppointmentConfirmation } from '../../lib/appointment-confirmation-client';
import AppointmentMeetingFields, { DEFAULT_APPOINTMENT_MEETING, type AppointmentMeeting } from '../../components/crm/AppointmentMeetingFields';
import { useStaffAccess, useStaffWorkspace } from '../../context/StaffWorkspaceContext';
import { canAccessTeamPage } from '../../lib/team-page-access';
import { staffRecordScope } from '../../lib/staff-records';

interface CalendarEvent {
  id: string; subject: string; title?: string; description: string | null;
  event_date: string; event_time: string | null; all_day: boolean;
  status: 'scheduled' | 'completed' | 'cancelled'; related_type: string | null; related_id: string | null;
  client_id?: string | null; updated_at?: string;
  meeting_type?: AppointmentMeeting['meeting_type']; duration_minutes?: number; location?: string;
  google_meet_url?: string | null; sync_status?: string; sync_error?: string | null;
  zoom_join_url?: string | null;
  zoom_meeting_id?: string | null; zoom_create_attempted_at?: string | null; revision?: number;
}
interface DayTask { id: string; subject: string; due_date: string | null; related_href?: string | null }
interface EventForm extends AppointmentMeeting { id: string; title: string; description: string; event_date: string; event_time: string; all_day: boolean; related_type: '' | 'lead' | 'client'; related_id: string }
const inputClass = 'w-full rounded border border-cui-border px-3 py-2 text-sm';
const buttonClass = 'rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';

function newForm(timeZone: AgencyTimeZone): EventForm {
  return { ...DEFAULT_APPOINTMENT_MEETING, id: crypto.randomUUID(), title: '', description: '', event_date: calendarDate(new Date(), timeZone), event_time: '09:00', all_day: false, related_type: '', related_id: '' };
}

function Scheduler(): JSX.Element {
  const access = useStaffAccess();
  const full = useStaffWorkspace() === 'full';
  const canEdit = full || access.mode === 'legacy' || ['agency', 'assigned', 'self'].includes(String(access.grants['calendar.edit']));
  const canViewTasks = full || canAccessTeamPage(access, '/tasks');
  const canSend = full || access.mode === 'legacy' || ['agency', 'assigned'].includes(String(access.grants['messages.send']));
  const canViewLeads = full || staffRecordScope(access, 'leads') !== null;
  const canViewAccounts = full || staffRecordScope(access, 'accounts') !== null;
  const agency = useAgencyTimeZone();
  const timeZone = agency.timeZone ?? DEFAULT_AGENCY_TIME_ZONE;
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
  const [confirmEmail, setConfirmEmail] = useState(true), [pendingConfirmation, setPendingConfirmation] = useState<{ id: string; conversation: string } | null>(null);
  const [notice, setNotice] = useState('');
  const calendar = useRef<FullCalendar>(null);
  const openedLink = useRef<string | null>(null);
  const eventParam = params.get('event');
  const { refresh: refreshNotifications } = useNotifications();
  useEffect(() => {
    if (agency.error) setError(agency.error);
  }, [agency.error]);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [rows, dayTasks] = await Promise.all([
        workspacePages<CalendarEvent>('/api/events?status=all&order=asc', 200, 'offset'),
        canViewTasks ? workspacePages<DayTask>('/api/tasks?status=open&due=today&sort=due_asc&include=related&limit=200', 200, 'offset') : Promise.resolve([]),
      ]);
      setEvents(rows); setTasks(dayTasks); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load calendar.'); }
    finally { setLoading(false); }
  }, [canViewTasks]);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback((event: CalendarEvent): void => {
    setEditing(event);
    setConfirmEmail(true);
    setForm({
      id: event.id, title: event.title || event.subject, description: event.description || '',
      event_date: event.event_date.slice(0, 10), event_time: event.event_time?.slice(0, 5) || '09:00', all_day: event.all_day,
      related_type: event.related_type === 'lead' ? 'lead' : event.related_type === 'client' || event.client_id ? 'client' : '',
      related_id: event.related_type === 'lead' ? event.related_id || '' : event.client_id || event.related_id || '',
      meeting_type: event.meeting_type ?? 'phone', duration_minutes: event.duration_minutes ?? 30, location: event.location ?? '',
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
  const calendarEvents = visible.map((event) => {
    const start = event.all_day ? event.event_date.slice(0, 10) : `${event.event_date.slice(0, 10)}T${event.event_time?.slice(0, 5) || '09:00'}`;
    const color = event.status === 'cancelled' ? '#73818f' : event.status === 'completed' ? '#4dbd74' : '#20a8d8';
    return { id: event.id, title: `${event.status === 'cancelled' ? 'Cancelled: ' : ''}${event.title || event.subject}`, start,
      end: event.all_day ? undefined : new Date(Date.parse(`${start}Z`) + (event.duration_minutes ?? 30) * 60000).toISOString().slice(0, 19),
      allDay: event.all_day, backgroundColor: color, borderColor: color, startEditable: event.status === 'scheduled' };
  });
  async function save(id: string, changes: Record<string, unknown>, create = false): Promise<boolean> {
    if (!canEdit) { setError('Calendar editing permission is required.'); return false; }
    if (!agency.timeZone) { setError(agency.error ?? 'Agency time zone is still loading.'); return false; }
    setBusy(true); setError('');
    try {
      const saved = await workspaceFetch<CalendarEvent>('/api/events', {
        method: create ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changes, id, expected_updated_at: create ? undefined : events.find((event) => event.id === id)?.updated_at }),
      });
      await load(); await refreshNotifications();
      const old = events.find((event) => event.id === id);
      const relatedType = saved.related_type ?? changes.related_type ?? old?.related_type;
      const relatedId = saved.related_id ?? changes.related_id ?? old?.related_id;
      const notify = create || changes.event_date !== undefined || changes.event_time !== undefined || changes.status === 'cancelled'
        || changes.meeting_type !== undefined || changes.location !== undefined || changes.duration_minutes !== undefined;
      if (notify && canSend && confirmEmail && (relatedType === 'lead' || relatedType === 'client') && typeof relatedId === 'string') {
        const pending = { id, conversation: `${relatedType}:${relatedId}` };
        setPendingConfirmation(pending);
        try { const sent = await sendAppointmentConfirmation(id, pending.conversation); setPendingConfirmation(null); setNotice(sent.message); }
        catch (failure) { setError(`Appointment saved. ${failure instanceof Error ? failure.message : 'Confirmation could not be sent.'}`); }
      }
      if (saved.sync_status === 'failed' || saved.sync_status === 'pending') setError(saved.sync_error || 'Appointment saved. Calendar update is pending; retry before sending confirmation.');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save appointment.'); return false; }
    finally { setBusy(false); }
  }
  async function retrySync(id: string, recovery?: CalendarEvent): Promise<void> {
    if (recovery && !window.confirm('Only continue after checking your connected Zoom account and confirming this appointment has no Zoom meeting. The CRM will check again before creating a replacement.')) return;
    setBusy(true); setError('');
    try {
      const saved = await workspaceFetch<CalendarEvent>(`/api/events/${encodeURIComponent(id)}/sync`, { method: 'POST',
        ...(recovery ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_zoom_not_created: true, expected_revision: recovery.revision }) } : {}),
      });
      await load();
      if (saved.sync_status === 'failed' || saved.sync_status === 'pending') setError(saved.sync_error || 'Appointment sync is not complete. Retry sync.');
      else setNotice('Calendar updated.');
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Calendar sync failed. Try again.'); }
    finally { setBusy(false); }
  }
  function dateClick(arg: DateClickArg): void {
    if (!agency.timeZone) { setError(agency.error ?? 'Agency time zone is still loading.'); return; }
    setEditing(null); setError('');
    setForm({ ...newForm(agency.timeZone), event_date: arg.dateStr.slice(0, 10), event_time: arg.dateStr.slice(11, 16) || '09:00', all_day: arg.allDay });
  }
  async function drop(arg: EventDropArg): Promise<void> {
    // UTC mode preserves the agency wall-clock fields without browser-zone conversion.
    const start = arg.event.start;
    if (!start) { arg.revert(); setError('The new appointment time is invalid.'); return; }
    if (events.find((event) => event.id === arg.event.id)?.status !== 'scheduled') { arg.revert(); setError('Only scheduled appointments can be rescheduled.'); return; }
    if (!window.confirm('Reschedule this appointment to the selected time and notify its contact?')) { arg.revert(); return; }
    const ok = await save(arg.event.id, { event_date: start.toISOString().slice(0, 10), event_time: arg.event.allDay ? null : start.toISOString().slice(11, 16), all_day: arg.event.allDay });
    if (!ok) arg.revert();
  }
  return <SectionLayout title="Calendar & Events">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cui-border bg-white p-5 shadow-card">
      <div><h2 className="text-xl font-semibold text-cui-text">Calendar &amp; appointments</h2><p className="mt-2 text-sm text-cui-muted">All times are {timeZone}.</p></div>
      <div className="flex gap-2">
        <Link href={list ? '/scheduler' : '/scheduler?view=list'} className="rounded border border-cui-border px-3 py-2 text-sm font-semibold text-cui-primary">{list ? 'Calendar view' : 'List view'}</Link>
        {canEdit ? <button className={buttonClass} disabled={!agency.timeZone} onClick={() => { setEditing(null); setError(''); setForm(newForm(timeZone)); }}>+ New Event</button> : null}
      </div>
    </div>
    {error ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button disabled={loading || busy} onClick={() => void load()} className="font-semibold underline">Refresh calendar</button></div> : null}
    {notice ? <p role="status" className="mb-3 text-sm text-cui-success">{notice}</p> : null}
    {pendingConfirmation ? <button type="button" disabled={busy} className="mb-3 text-sm font-semibold text-cui-primary underline" onClick={() => {
      setBusy(true); setError('');
      void sendAppointmentConfirmation(pendingConfirmation.id, pendingConfirmation.conversation)
        .then((result) => { setPendingConfirmation(null); setNotice(result.message); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Confirmation could not be sent.'))
        .finally(() => setBusy(false));
    }}>Retry appointment confirmation</button> : null}
    {loading ? <p className="mb-3 text-sm text-cui-muted">Loading calendar...</p> : null}
    <div className="mb-4 flex items-center gap-3"><label htmlFor="event-status" className="text-sm font-semibold">Show</label><select id="event-status" className="rounded border border-cui-border bg-white p-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All appointments</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><Link href="/account?tab=signature" className="text-sm font-semibold text-cui-primary underline">Connect calendar</Link></div>
    {canEdit && canSend ? <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmEmail} onChange={(event) => setConfirmEmail(event.target.checked)} />Email contacts about cancellations and reschedules</label> : null}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <Card><CardBody>
        {list ? <div className="space-y-3">
          {visible.map((event) => <article key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cui-border p-3">
            <div><button onClick={() => open(event)} className="text-left text-sm font-semibold text-cui-primary hover:underline">{event.title || event.subject}</button><p className="mt-1 text-xs text-cui-muted">{event.event_date.slice(0, 10)} - {event.all_day ? 'All day' : `${event.event_time?.slice(0, 5)} ${timeZone}`} - {event.status}</p></div>
            <div className="flex flex-wrap gap-2">
              {event.google_meet_url && event.status === 'scheduled' ? <a href={event.google_meet_url} target="_blank" rel="noreferrer" className="px-2 py-1.5 text-xs font-semibold text-cui-primary underline">Join Meet</a> : null}
              {event.zoom_join_url && event.status === 'scheduled' ? <a href={event.zoom_join_url} target="_blank" rel="noreferrer" className="px-2 py-1.5 text-xs font-semibold text-cui-primary underline">Join Zoom</a> : null}
              {canEdit && event.status !== 'cancelled' ? <button disabled={busy} onClick={() => void save(event.id, { status: event.status === 'completed' ? 'scheduled' : 'completed' })} className="rounded border border-cui-border px-3 py-1.5 text-xs font-semibold text-cui-primary disabled:opacity-50">{event.status === 'completed' ? 'Reopen' : 'Complete'}</button> : null}
              {canEdit && event.status === 'scheduled' ? <>
                <button disabled={busy} onClick={() => open(event)} className="rounded border border-cui-border px-3 py-1.5 text-xs font-semibold text-cui-primary">Reschedule</button>
                <button disabled={busy} onClick={() => { if (window.confirm(`Cancel "${event.title || event.subject}"? Its history will remain and reminders will stop.`)) void save(event.id, { status: 'cancelled' }); }} className="rounded border border-cui-danger px-3 py-1.5 text-xs font-semibold text-cui-danger">Cancel appointment</button>
              </> : null}
            </div>
            {event.sync_status === 'failed' || event.sync_status === 'pending' ? <p role="alert" className="w-full text-xs text-cui-danger">{event.sync_error || 'Calendar update pending.'}{' '}{canEdit ? <button disabled={busy} className="font-semibold underline" onClick={() => void retrySync(event.id)}>Retry calendar sync</button> : null}
              {canEdit && event.zoom_create_attempted_at && !event.zoom_meeting_id ? <button disabled={busy} className="ml-3 font-semibold underline" onClick={() => void retrySync(event.id, event)}>I checked Zoom: no meeting exists</button> : null}</p> : null}
          </article>)}
          {!loading && !visible.length ? <p className="text-sm text-cui-muted">No appointments in this view.</p> : null}
        </div> : <FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} timeZone="UTC" initialView="dayGridMonth" headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }} events={calendarEvents} editable={canEdit && !busy} eventDurationEditable={false} selectable={canEdit} dateClick={canEdit ? dateClick : undefined} eventClick={(arg) => { const event = events.find((row) => row.id === arg.event.id); if (event) open(event); }} eventDrop={(arg) => void drop(arg)} />}
      </CardBody></Card>
      <div className="space-y-5">
        <Card><CardHeader>Today in {timeZone}</CardHeader><CardBody><div className="space-y-3">{events.filter((event) => event.event_date.slice(0, 10) === calendarDate(new Date(), timeZone)).map((event) => <div key={event.id} className="border-b border-cui-border pb-3"><button onClick={() => open(event)} className="text-left text-sm font-semibold text-cui-primary">{event.title || event.subject}</button><p className="mt-1 text-xs text-cui-muted">{event.all_day ? 'All day' : `${event.event_time?.slice(0, 5)} ${timeZone}`} - {event.status}</p></div>)}{!loading && !events.some((event) => event.event_date.slice(0, 10) === calendarDate(new Date(), timeZone)) ? <p className="text-sm text-cui-muted">No appointments today.</p> : null}</div></CardBody></Card>
        {canViewTasks ? <Card><CardHeader>Tasks due today or overdue</CardHeader><CardBody><div className="space-y-3">{tasks.map((task) => <div key={task.id} className="border-b border-cui-border pb-3"><Link href={(task.related_href || '/tasks') as Route} className="text-sm font-semibold text-cui-primary">{task.subject}</Link><p className="mt-1 text-xs text-cui-muted">{formatAgencyDateTime(task.due_date, timeZone)}</p></div>)}{!loading && !tasks.length ? <p className="text-sm text-cui-muted">No open tasks due today.</p> : null}<Link href="/tasks" className="inline-block text-sm font-semibold text-cui-primary">Open Tasks</Link></div></CardBody></Card> : null}
      </div>
    </div>
    {form ? <Dialog.Root open onOpenChange={(opened) => { if (!opened && !busy) setForm(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()} className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
      <Dialog.Title className="mb-2 text-lg font-semibold">{editing ? canEdit ? 'Edit Event' : 'View Event' : 'New Event'}</Dialog.Title>
      <Dialog.Description className="mb-4 text-sm text-cui-muted">{canEdit ? `Save an appointment in ${timeZone} and its connected task together.` : `Appointment in ${timeZone}.`}</Dialog.Description>
      {error ? <p role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p> : null}
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(form.id, { subject: form.title, title: form.title, description: form.description, event_date: form.event_date, event_time: form.all_day ? null : form.event_time, all_day: form.all_day, related_type: form.related_type || null, related_id: form.related_id || null, client_id: form.related_type === 'client' ? form.related_id : null, meeting_type: form.meeting_type, duration_minutes: form.duration_minutes, location: form.location }, !editing).then((ok) => { if (ok) setForm(null); }); }}>
        <fieldset disabled={!canEdit} className="space-y-3">
        <label className="block text-sm font-semibold">Event title<input autoFocus required maxLength={240} className={`${inputClass} mt-1 font-normal`} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="block text-sm font-semibold">Description<textarea className={`${inputClass} mt-1 font-normal`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="block text-sm font-semibold">Date<input required type="date" className={`${inputClass} mt-1 font-normal`} value={form.event_date} onChange={(event) => setForm({ ...form, event_date: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked, meeting_type: event.target.checked && (form.meeting_type === 'google_meet' || form.meeting_type === 'zoom') ? 'phone' : form.meeting_type })} />All-day event (task due 9 AM {timeZone})</label>
        {!form.all_day ? <label className="block text-sm font-semibold">Time ({timeZone})<input required type="time" className={`${inputClass} mt-1 font-normal`} value={form.event_time} onChange={(event) => setForm({ ...form, event_time: event.target.value })} /></label> : null}
        <AppointmentMeetingFields value={form} onChange={(meeting) => setForm({ ...form, ...meeting })} disabled={busy || editing?.status === 'cancelled'} allDay={form.all_day} />
        <label className="block text-sm font-semibold">Link to<select aria-label="Link to" className={`${inputClass} mt-1 font-normal`} value={form.related_type} onChange={(event) => setForm({ ...form, related_type: event.target.value === 'lead' ? 'lead' : event.target.value === 'client' ? 'client' : '', related_id: '' })}><option value="">Standalone appointment</option>{canViewLeads ? <option value="lead">Lead</option> : null}{canViewAccounts ? <option value="client">Account</option> : null}</select></label>
        {form.related_type && canEdit ? <RecordPicker type={form.related_type} value={form.related_id} scoped={!full} onChange={(id) => setForm({ ...form, related_id: id })} /> : null}
        {form.related_type && canEdit && canSend ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.checked)} />Send appointment confirmation from my Gmail after saving.</label> : null}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {canEdit && editing?.status === 'scheduled' ? <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(`Cancel "${editing.title || editing.subject}"? Its history will remain and reminders will stop.`)) void save(editing.id, { status: 'cancelled' }).then((ok) => { if (ok) setForm(null); });
          }} className="rounded border border-cui-danger px-3 py-2 text-sm text-cui-danger">Cancel appointment</button> : null}
          <button type="button" disabled={busy} onClick={() => setForm(null)} className="rounded border border-cui-border px-3 py-2 text-sm">Cancel</button>
          {canEdit && editing?.status !== 'cancelled' ? <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Saving...' : editing ? 'Update Event' : 'Save Event'}</button> : editing?.status === 'cancelled' ? <span className="py-2 text-sm text-cui-muted">Cancelled</span> : null}
        </div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root> : null}
  </SectionLayout>;
}

export default function SchedulerPage(): JSX.Element {
  return <Suspense fallback={<SectionLayout title="Calendar & Events"><p>Loading calendar...</p></SectionLayout>}><Scheduler /></Suspense>;
}
