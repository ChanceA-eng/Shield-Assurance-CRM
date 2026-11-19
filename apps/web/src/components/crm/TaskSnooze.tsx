'use client';

import { useState } from 'react';
import { DEFAULT_AGENCY_TIME_ZONE, agencyDateTimeInput, type AgencyTimeZone } from '../../lib/agency-time';
import { customSnoozeIso, defaultSnoozeInput, snoozePresetIso } from '../../lib/task-snooze';
import { useAgencyTimeZone } from '../../hooks/useAgencyTimeZone';

export default function TaskSnooze({
  subject, disabled = false, onSave, timeZone: providedTimeZone,
}: { subject: string; disabled?: boolean; timeZone?: AgencyTimeZone; onSave: (iso: string) => Promise<boolean> }): JSX.Element {
  const agency = useAgencyTimeZone();
  const timeZone = providedTimeZone ?? agency.timeZone;
  const zone = timeZone ?? DEFAULT_AGENCY_TIME_ZONE;
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (iso: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (await onSave(iso)) setValue(null);
      else setError('The snooze was not saved. Your chosen time is still selected ? try again.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save snooze. Try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <select defaultValue="" disabled={disabled || saving || !timeZone} aria-label={`Snooze ${subject}`}
        onChange={(event) => {
          const option = event.target.value;
          event.target.value = '';
          if (!timeZone) { setError(agency.error ?? 'Agency time zone is still loading.'); return; }
          if (option === 'custom') { setValue(defaultSnoozeInput(new Date(), zone)); setError(null); }
          else if (option === 'later' || option === 'tomorrow' || option === 'nextweek') void save(snoozePresetIso(option, new Date(), zone));
        }} className="shrink-0 rounded border border-cui-border bg-white px-2 py-1 text-xs text-cui-muted">
        <option value="" disabled>Snooze...</option>
        <option value="later">Later today (+3 hrs)</option>
        <option value="tomorrow">Tomorrow 9 AM</option>
        <option value="nextweek">Next Monday 9 AM</option>
        <option value="custom">Pick date &amp; time...</option>
      </select>
      {value !== null ? (
        <form className="flex basis-full flex-wrap items-center justify-end gap-2 rounded border border-cui-primary/30 bg-cui-primary/5 px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = customSnoozeIso(value, new Date(), zone);
            if ('error' in result) setError(result.error);
            else void save(result.iso);
          }}>
          <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-cui-text">Snooze until (agency time)
            <input type="datetime-local" value={value} min={agencyDateTimeInput(new Date(), zone)} disabled={saving}
              onChange={(event) => { setValue(event.target.value); setError(null); }} autoFocus
              className="rounded border border-cui-border bg-white px-2 py-1 text-xs font-normal" />
          </label>
          <button type="submit" disabled={disabled || saving} className="rounded bg-cui-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save snooze'}</button>
          <button type="button" disabled={saving} onClick={() => { setValue(null); setError(null); }} className="rounded border border-cui-border bg-white px-3 py-1 text-xs font-semibold text-cui-muted">Cancel</button>
        </form>
      ) : null}
      {agency.error && !providedTimeZone ? <p role="alert" className="basis-full text-xs font-semibold text-cui-danger">{agency.error}</p> : null}
      {error ? <p role="alert" className="basis-full text-xs font-semibold text-cui-danger">{error}</p> : null}
    </>
  );
}
