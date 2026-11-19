'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useAgencyTimeZone } from '../../hooks/useAgencyTimeZone';
import { agencyDateTimeInput, agencyInputToIso } from '../../lib/agency-time';
import ConversationTool from './ConversationTool';
import { sendAppointmentConfirmation } from '../../lib/appointment-confirmation-client';
import AppointmentMeetingFields, { DEFAULT_APPOINTMENT_MEETING, type AppointmentMeeting } from './AppointmentMeetingFields';

interface Appointment {
  id: string; subject: string; event_date: string; event_time: string | null; updated_at?: string;
  description?: string | null; meeting_type?: AppointmentMeeting['meeting_type']; duration_minutes?: number;
  location?: string; status?: string; google_meet_url?: string | null; sync_status?: string; sync_error?: string | null;
  zoom_join_url?: string | null;
  zoom_meeting_id?: string | null; zoom_create_attempted_at?: string | null; revision?: number;
}

export default function ConversationAppointment({ target, name, disabled = false }: {
  target: RecordTarget; name: string; disabled?: boolean;
}): JSX.Element {
  const agency = useAgencyTimeZone();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(`Appointment with ${name}`), [time, setTime] = useState(''), [notes, setNotes] = useState('');
  const [meeting, setMeeting] = useState<AppointmentMeeting>(DEFAULT_APPOINTMENT_MEETING);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [rows, setRows] = useState<Appointment[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const identity = useRef<{ id: string; payload: string; attempted: boolean } | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(true), [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const conversation = `${target.type}:${target.id}`;
  const confirm = async (id: string): Promise<void> => {
    setBusy(true); setError('');
    try { const result = await sendAppointmentConfirmation(id, conversation); setPendingConfirmation(null); setNotice(result.message); }
    catch (failure) { setPendingConfirmation(id); setError(`Appointment saved. ${failure instanceof Error ? failure.message : 'Confirmation could not be sent.'}`); }
    finally { setBusy(false); }
  };
  const endpoint = `/api/events?related_type=${target.type}&related_id=${encodeURIComponent(target.id)}&status=scheduled`;
  useEffect(() => {
    let active = true;
    void workspaceFetch<Appointment[]>(endpoint).then((data) => { if (active) setRows(data); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Appointments could not be loaded.'); });
    return () => { active = false; };
  }, [endpoint]);
  const save = async (): Promise<void> => {
    const iso = agency.timeZone ? agencyInputToIso(time, agency.timeZone) : null;
    const changes = { subject: title.trim(), title: title.trim(), description: notes, event_date: time.slice(0, 10),
      event_time: time.slice(11), all_day: false, related_type: target.type, related_id: target.id,
      client_id: target.type === 'client' ? target.id : null, ...meeting };
    const payload = JSON.stringify(changes);
    if (!iso || !title.trim() || (Date.parse(iso) <= Date.now() && identity.current?.payload !== payload)) {
      setError('Enter a title and a valid future appointment time.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      if (editing) {
        await workspaceFetch<Appointment>('/api/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...changes, id: editing.id, expected_updated_at: editing.updated_at }) });
        const savedId = editing.id;
        identity.current = null; setEditing(null); setOpen(false); setTime(''); setNotes('');
        setNotice('Appointment rescheduled.');
        if (confirmEmail) await confirm(savedId);
        return;
      }
      if (identity.current?.attempted && identity.current.payload !== payload) {
        const previous = await workspaceFetch<Appointment[]>(`/api/events?id=${identity.current.id}`);
        if (previous.length) throw new Error('Your previous appointment was saved. Edit it in the calendar instead of creating another.');
      }
      if (identity.current?.payload !== payload) identity.current = { id: crypto.randomUUID(), payload, attempted: false };
      const existing = identity.current.attempted
        ? await workspaceFetch<Array<Appointment & typeof changes>>(`/api/events?id=${identity.current.id}`) : [];
      if (existing.length && Object.entries(changes).some(([key, value]) => {
        const current = existing[0][key as keyof typeof changes];
        const stored = key === 'meeting_type' ? current ?? 'phone' : key === 'duration_minutes' ? current ?? 30 : key === 'location' ? current ?? '' : current;
        return key === 'event_time' ? String(stored).slice(0, 5) !== value : stored !== value;
      })) throw new Error('This appointment changed. Review it in the calendar before retrying.');
      if (!existing.length) {
        identity.current.attempted = true;
        await workspaceFetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...changes, id: identity.current.id }) });
      }
      const savedId = identity.current.id;
      identity.current = null; setOpen(false); setTime(''); setNotes(''); setNotice('Appointment saved to the calendar.');
      if (confirmEmail) await confirm(savedId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Appointment could not be saved. Your details are retained.'); }
    finally {
      if (identity.current === null) {
        try { setRows(await workspaceFetch<Appointment[]>(endpoint)); }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Appointment saved, but the list could not be refreshed.'); }
      }
      setBusy(false);
    }
  };
  const cancel = async (row: Appointment): Promise<void> => {
    if (!window.confirm(`Cancel "${row.subject}"? Its history will be kept and reminders stopped.${confirmEmail ? ' A cancellation email will be requested.' : ''}`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch('/api/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, expected_updated_at: row.updated_at, status: 'cancelled' }) });
      setNotice('Appointment cancelled.');
      if (confirmEmail) await confirm(row.id);
      setRows(await workspaceFetch<Appointment[]>(endpoint));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Cancellation could not be completed. Refresh before retrying.'); }
    finally { setBusy(false); }
  };
  const retrySync = async (id: string, recovery?: Appointment): Promise<void> => {
    if (recovery && !window.confirm('Only continue after checking your connected Zoom account and confirming this appointment has no Zoom meeting. The CRM will check again before creating a replacement.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await workspaceFetch<Appointment>(`/api/events/${encodeURIComponent(id)}/sync`, { method: 'POST',
        ...(recovery ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_zoom_not_created: true, expected_revision: recovery.revision }) } : {}),
      });
      setRows(await workspaceFetch<Appointment[]>(endpoint));
      if (saved.sync_status === 'failed' || saved.sync_status === 'pending') setError(saved.sync_error || 'Appointment sync is not complete. Retry sync.');
      else setNotice('Calendar updated.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Calendar sync failed. Try again.'); }
    finally { setBusy(false); }
  };
  return <ConversationTool label="Book" title="Appointments" selected={rows.length > 0}>
    <div className="space-y-3">
      {error || agency.error ? <p role="alert" className="text-xs text-cui-danger">{error || agency.error}</p> : null}
      {notice ? <p role="status" className="text-xs text-cui-success">{notice}</p> : null}
      {pendingConfirmation ? <button type="button" disabled={busy || disabled} onClick={() => void confirm(pendingConfirmation)}
        className="text-xs font-semibold text-cui-primary underline">Retry appointment confirmation</button> : null}
      {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p>{row.subject} · {row.event_date} {row.event_time?.slice(0, 5)}</p>
        <div className="flex flex-wrap gap-3">
          {row.google_meet_url && row.status !== 'cancelled' ? <a href={row.google_meet_url} target="_blank" rel="noreferrer" className="text-cui-primary underline">Join Meet</a> : null}
          {row.zoom_join_url && row.status !== 'cancelled' ? <a href={row.zoom_join_url} target="_blank" rel="noreferrer" className="text-cui-primary underline">Join Zoom</a> : null}
          <button type="button" disabled={busy || disabled} className="text-cui-primary underline" onClick={() => void confirm(row.id)}>Send confirmation</button>
          <button type="button" disabled={busy || disabled} className="text-cui-primary underline" onClick={() => {
            setEditing(row); setTitle(row.subject); setTime(`${row.event_date.slice(0, 10)}T${row.event_time?.slice(0, 5) || '09:00'}`);
            setNotes(row.description ?? ''); setMeeting({ meeting_type: row.meeting_type ?? 'phone', duration_minutes: row.duration_minutes ?? 30, location: row.location ?? '' });
            setOpen(true); setConfirmEmail(true); setError('');
          }}>Reschedule</button>
          <button type="button" disabled={busy || disabled} className="text-cui-danger underline" onClick={() => void cancel(row)}>Cancel appointment</button>
        </div>
        {row.sync_status === 'failed' || row.sync_status === 'pending' ? <p role="alert" className="w-full text-cui-danger">{row.sync_error || 'Calendar update is pending.'}{' '}
          <button type="button" disabled={busy || disabled} className="font-semibold underline" onClick={() => void retrySync(row.id)}>Retry calendar sync</button>
          {row.zoom_create_attempted_at && !row.zoom_meeting_id ? <button type="button" disabled={busy || disabled} className="ml-3 font-semibold underline" onClick={() => void retrySync(row.id, row)}>I checked Zoom: no meeting exists</button> : null}</p> : null}
      </div>)}
      <div className="flex flex-wrap gap-3 text-xs">
        <button type="button" disabled={disabled || busy} className="font-semibold text-cui-primary disabled:opacity-50"
          onClick={() => { setOpen((value) => !value); setEditing(null); setTitle(`Appointment with ${name}`); setMeeting(DEFAULT_APPOINTMENT_MEETING); }}>{open ? 'Close appointment' : 'Book appointment'}</button>
        <Link href="/scheduler" className="text-cui-primary underline">Open calendar</Link>
        <button type="button" disabled={busy || disabled} className="text-cui-primary underline" onClick={() => {
          setBusy(true);
          void workspaceFetch<Appointment[]>(endpoint).then((appointments) => { setRows(appointments); setError(''); })
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Appointments could not be refreshed.'))
            .finally(() => setBusy(false));
        }}>Refresh appointments</button>
      </div>
      {!open && rows.length ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmEmail}
        onChange={(event) => setConfirmEmail(event.target.checked)} />Email the contact when cancelling.</label> : null}
      {open ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy || disabled} className="space-y-3">
          <label className="block text-xs font-semibold">Appointment title<input required maxLength={240} value={title}
            onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded border border-cui-border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-semibold">Appointment date and time · {agency.timeZone ?? 'Loading time zone'}
            <input type="datetime-local" required value={time} disabled={!agency.timeZone}
              min={agency.timeZone ? agencyDateTimeInput(new Date(), agency.timeZone) : undefined}
              onChange={(event) => setTime(event.target.value)} className="mt-1 block max-w-full rounded border border-cui-border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-semibold">Appointment notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full rounded border border-cui-border px-3 py-2 text-sm" /></label>
          <AppointmentMeetingFields value={meeting} onChange={setMeeting} />
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.checked)} />Send appointment confirmation from my Gmail after saving.</label>
          <button disabled={!agency.timeZone || !time || !title.trim()} className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Saving appointment...' : editing ? 'Save reschedule' : 'Save appointment'}
          </button>
        </fieldset>
      </form> : null}
    </div>
  </ConversationTool>;
}
