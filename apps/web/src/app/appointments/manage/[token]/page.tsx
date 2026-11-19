'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface PublicAppointment {
  subject: string; event_date: string; event_time: string | null; all_day: boolean; status: string;
  meeting_type: 'phone' | 'in_person' | 'google_meet' | 'zoom'; duration_minutes: number; location: string | null;
  zoom_join_url: string | null;
  google_meet_url: string | null; sync_error: string | null; revision: number; time_zone: string;
}

const kinds = { phone: 'Phone call', in_person: 'In person', google_meet: 'Google Meet', zoom: 'Zoom' } as const;
const field = 'w-full rounded border border-cui-border bg-white p-2 text-sm';

export default function ManageAppointmentPage(): JSX.Element {
  const token = String(useParams<{ token: string }>().token ?? '');
  const [appointment, setAppointment] = useState<PublicAppointment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const endpoint = `/api/appointments/manage/${encodeURIComponent(token)}`;

  const load = useCallback(async (): Promise<void> => {
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as { appointment?: PublicAppointment; message?: string };
      if (!response.ok || !body.appointment) throw new Error(body.message ?? 'This appointment link is invalid or expired.');
      setAppointment(body.appointment);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'This appointment could not be loaded.'); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (payload: Record<string, unknown>, done: string): Promise<void> => {
    if (!appointment) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, revision: appointment.revision }) });
      const body = await response.json().catch(() => ({})) as { appointment?: PublicAppointment; message?: string };
      if (!response.ok || !body.appointment) throw new Error(body.message ?? 'The appointment could not be changed. Contact your agent.');
      setAppointment(body.appointment); setChanging(false); setNotice(done);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The appointment could not be changed.'); }
    finally { setBusy(false); }
  };

  const cancelled = appointment?.status === 'cancelled';
  return <main className="flex min-h-screen items-center justify-center bg-cui-body px-4 py-10">
    <div className="w-full max-w-md space-y-4 rounded-xl border border-cui-border bg-white p-6 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-widest text-cui-muted">Shield Assurance</p>
      <h1 className="text-xl font-semibold text-cui-text">Your appointment</h1>
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-cui-success">{notice}</p> : null}
      {appointment ? <>
        <div className="space-y-1 text-sm">
          <p className="font-semibold">{appointment.subject}</p>
          <p>{appointment.event_date.slice(0, 10)}{appointment.all_day ? ' · All day' : ` · ${appointment.event_time?.slice(0, 5) ?? ''} ${appointment.time_zone}`}</p>
          <p>{kinds[appointment.meeting_type]} · {appointment.duration_minutes} minutes</p>
          {appointment.location ? <p>{appointment.location}</p> : null}
          <p className={cancelled ? 'text-cui-danger' : 'text-cui-muted'}>{cancelled ? 'Cancelled' : appointment.status === 'scheduled' ? 'Scheduled' : 'Completed'}</p>
          {appointment.google_meet_url && !cancelled ? <a href={appointment.google_meet_url} target="_blank" rel="noreferrer" className="font-semibold text-cui-primary underline">Join Google Meet</a> : null}
          {appointment.zoom_join_url && !cancelled ? <a href={appointment.zoom_join_url} target="_blank" rel="noreferrer" className="font-semibold text-cui-primary underline">Join Zoom</a> : null}
          {appointment.sync_error ? <p role="alert" className="text-cui-danger">{appointment.sync_error}</p> : null}
        </div>
        {appointment.status === 'scheduled' ? changing ? <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault(); void submit({ action: 'reschedule', event_date: date, event_time: time }, 'Appointment rescheduled.');
        }}>
          <label className="block text-sm">New date<input required type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="block text-sm">New time<input required type="time" className={field} value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <div className="flex gap-3">
            <button disabled={busy} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm new time</button>
            <button type="button" disabled={busy} className="text-sm underline" onClick={() => setChanging(false)}>Back</button>
          </div>
        </form> : <div className="flex flex-wrap gap-3">
          {!appointment.all_day ? <button disabled={busy} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => setChanging(true)}>Reschedule</button> : null}
          <button disabled={busy} className="rounded border border-cui-danger px-4 py-2 text-sm font-semibold text-cui-danger disabled:opacity-50"
            onClick={() => { if (window.confirm('Cancel this appointment?')) void submit({ action: 'cancel' }, 'Appointment cancelled.'); }}>Cancel appointment</button>
        </div> : null}
      </> : error ? null : <p className="text-sm text-cui-muted">Loading...</p>}
    </div>
  </main>;
}
