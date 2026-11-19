'use client';

import Link from 'next/link';

export interface AppointmentMeeting {
  meeting_type: 'phone' | 'in_person' | 'google_meet' | 'zoom';
  duration_minutes: number;
  location: string;
}
export const DEFAULT_APPOINTMENT_MEETING: AppointmentMeeting = { meeting_type: 'phone', duration_minutes: 30, location: '' };

export default function AppointmentMeetingFields({ value, onChange, disabled = false, allDay = false }: {
  value: AppointmentMeeting; onChange: (value: AppointmentMeeting) => void; disabled?: boolean; allDay?: boolean;
}): JSX.Element {
  const input = 'crm-input mt-1';
  return <fieldset disabled={disabled} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-semibold">Meeting type<select className={input} value={value.meeting_type}
        onChange={(event) => {
          const type = event.target.value;
          if (type === 'phone' || type === 'in_person' || type === 'google_meet' || type === 'zoom') onChange({ ...value, meeting_type: type });
        }}>
        <option value="phone">Phone</option><option value="in_person">In person</option><option value="google_meet" disabled={allDay}>Google Meet</option>
        {value.meeting_type === 'zoom' ? <option value="zoom">Zoom (existing appointment)</option> : null}
      </select></label>
      {!allDay ? <label className="block text-xs font-semibold">Duration<select className={input} value={value.duration_minutes}
        onChange={(event) => onChange({ ...value, duration_minutes: Number(event.target.value) })}>
        {[15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
      </select></label> : null}
    </div>
    {value.meeting_type !== 'google_meet' && value.meeting_type !== 'zoom' ? <label className="block text-xs font-semibold">{value.meeting_type === 'phone' ? 'Phone / calling instructions' : 'Meeting address'}
      <input className={input} maxLength={1000} value={value.location} onChange={(event) => onChange({ ...value, location: event.target.value })} />
    </label> : value.meeting_type === 'google_meet' ? <p className="text-xs text-cui-muted"><Link href="/account?tab=signature" className="text-cui-primary underline">Calendar connection</Link></p> : null}
  </fieldset>;
}
