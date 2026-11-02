'use client';

import { useState } from 'react';
import { arizonaDateTimeInput } from '../../lib/arizona-time';
import { customSnoozeIso, defaultSnoozeInput, snoozePresetIso } from '../../lib/task-snooze';

export default function TaskSnooze({
  subject, disabled = false, onSave,
}: { subject: string; disabled?: boolean; onSave: (iso: string) => Promise<boolean> }): JSX.Element {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (iso: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (await onSave(iso)) setValue(null);
      else setError('Snooze was not saved. Your selected time is retained.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save snooze. Try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <select defaultValue="" disabled={disabled || saving} aria-label={`Snooze ${subject}`}
        onChange={(event) => {
          const option = event.target.value;
          event.target.value = '';
          if (option === 'custom') { setValue(defaultSnoozeInput()); setError(null); }
          else if (option === 'later' || option === 'tomorrow' || option === 'nextweek') void save(snoozePresetIso(option));
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
            const result = customSnoozeIso(value);
            if ('error' in result) setError(result.error);
            else void save(result.iso);
          }}>
          <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-cui-text">Snooze until (Arizona time)
            <input type="datetime-local" value={value} min={arizonaDateTimeInput(new Date())} disabled={saving}
              onChange={(event) => { setValue(event.target.value); setError(null); }} autoFocus
              className="rounded border border-cui-border bg-white px-2 py-1 text-xs font-normal" />
          </label>
          <button type="submit" disabled={disabled || saving} className="rounded bg-cui-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save snooze'}</button>
          <button type="button" disabled={saving} onClick={() => { setValue(null); setError(null); }} className="rounded border border-cui-border bg-white px-3 py-1 text-xs font-semibold text-cui-muted">Cancel</button>
        </form>
      ) : null}
      {error ? <p role="alert" className="basis-full text-xs font-semibold text-cui-danger">{error}</p> : null}
    </>
  );
}
