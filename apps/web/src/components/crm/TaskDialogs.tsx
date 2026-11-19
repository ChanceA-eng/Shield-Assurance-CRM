'use client';

import React, { useState, type FormEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import RecordPicker from './RecordPicker';
import { addAgencyDays, agencyInputToIso, type AgencyTimeZone } from '../../lib/agency-time';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

function TaskDialogShell({ title, description, closeLabel, busy, onClose, children }: {
  title: string; description: string; closeLabel: string; busy: boolean; onClose: () => void; children: ReactNode;
}): JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm" />
        <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <button type="button" onClick={onClose} disabled={busy} aria-label={closeLabel} className="rounded-lg p-2 text-cui-muted hover:bg-cui-light disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const fieldLabel = 'block text-xs font-semibold text-cui-muted';

export function TaskCreateDialog({ timeZone, ready, onClose, onCreated }: {
  timeZone: AgencyTimeZone; ready: boolean; onClose: () => void; onCreated: () => Promise<void>;
}): JSX.Element {
  const [subject, setSubject] = useState('');
  const [recordType, setRecordType] = useState<'' | 'lead' | 'client'>('');
  const [recordId, setRecordId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = Boolean(subject.trim() || recordType || assignee.trim() || due || priority !== 'medium');
  const { confirmDiscard, markSaved } = useUnsavedChanges(dirty);
  const close = (): void => { if (!saving && confirmDiscard()) onClose(); };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    if (!ready) { setError('Agency time zone is still loading.'); return; }
    const action = subject.trim();
    if (!action) { setError('Enter a task action.'); return; }
    if (recordType && !recordId) { setError('Choose the related lead or account.'); return; }
    const dueIso = due
      ? agencyInputToIso(due, timeZone)
      : agencyInputToIso(`${addAgencyDays(new Date(), 1, timeZone)}T16:00`, timeZone);
    if (!dueIso) { setError('Choose a valid date and time.'); return; }
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setSaving(true);
    setError('');
    try {
      await workspaceFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subject: action, due_date: dueIso, priority, assignee: assignee.trim() || null, related_type: recordType || null, related_id: recordId || null }),
      });
      markSaved();
      await onCreated();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to add this task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskDialogShell title="New task" description="Create a task with an optional related record, assignee, due time and priority." closeLabel="Close new task" busy={saving} onClose={close}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.getAttribute('aria-label') === 'Search related record') event.preventDefault();
        }}>
        <label className={fieldLabel}>Task action
          <input aria-label="Task action" autoFocus required maxLength={240} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What needs doing?" className="crm-input mt-1" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>Link to
            <select aria-label="Task record type" value={recordType} onChange={(event) => { setRecordType(event.target.value === 'lead' ? 'lead' : event.target.value === 'client' ? 'client' : ''); setRecordId(''); }} className="crm-input mt-1">
              <option value="">General task</option><option value="lead">Lead</option><option value="client">Account</option>
            </select>
          </label>
          <label className={fieldLabel}>Assignee
            <input aria-label="Task assignee" maxLength={120} value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Agent name" className="crm-input mt-1" />
          </label>
        </div>
        {recordType ? <RecordPicker type={recordType} value={recordId} onChange={setRecordId} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>Due ({timeZone})
            <input aria-label="Task due date/time" type="datetime-local" value={due} disabled={!ready} onChange={(event) => setDue(event.target.value)} className="crm-input mt-1" />
            <span className="mt-1 block font-normal">Blank = tomorrow 4 PM</span>
          </label>
          <label className={fieldLabel}>Priority
            <select aria-label="Task priority" value={priority} onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high')} className="crm-input mt-1">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
        </div>
        {error ? <p role="alert" className="text-sm font-semibold text-cui-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} disabled={saving} className="crm-button">Cancel</button>
          <button type="submit" disabled={saving || !ready || !subject.trim()} className="crm-button-primary">{saving ? 'Creating...' : 'Create task'}</button>
        </div>
      </form>
    </TaskDialogShell>
  );
}

export function TaskRescheduleDialog({ count, timeZone, ready, onClose, onSubmit }: {
  count: number; timeZone: AgencyTimeZone; ready: boolean; onClose: () => void; onSubmit: (iso: string) => Promise<string | null>;
}): JSX.Element {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const iso = agencyInputToIso(value, timeZone);
    if (!iso) { setError('Choose a valid new date and time.'); return; }
    setSaving(true);
    setError('');
    const failure = await onSubmit(iso);
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  };
  return (
    <TaskDialogShell title={`Reschedule ${count} ${count === 1 ? 'task' : 'tasks'}`} description="Move every selected task to one new due date and time." closeLabel="Close reschedule" busy={saving} onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className={fieldLabel}>New due date/time ({timeZone})
          <input type="datetime-local" aria-label={`New due date/time - ${timeZone}`} autoFocus required value={value} disabled={saving || !ready}
            onChange={(event) => { setValue(event.target.value); setError(''); }} className="crm-input mt-1" />
        </label>
        {error ? <p role="alert" className="text-sm font-semibold text-cui-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className="crm-button">Cancel</button>
          <button type="submit" disabled={saving || !ready || !value} className="crm-button-primary">{saving ? 'Rescheduling...' : `Reschedule ${count} ${count === 1 ? 'task' : 'tasks'}`}</button>
        </div>
      </form>
    </TaskDialogShell>
  );
}

export function TaskReassignDialog({ subject, initial, onClose, onSubmit }: {
  subject: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<string | null>;
}): JSX.Element {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { confirmDiscard, markSaved } = useUnsavedChanges(name !== initial);
  const close = (): void => { if (!saving && confirmDiscard()) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const failure = await onSubmit(name.trim());
    setSaving(false);
    if (failure) setError(failure);
    else { markSaved(); onClose(); }
  };
  return (
    <TaskDialogShell title="Reassign task" description={`Change who owns ${subject}.`} closeLabel="Close reassign" busy={saving} onClose={close}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <p className="truncate text-sm font-semibold text-cui-text">{subject}</p>
        <label className={fieldLabel}>Assignee
          <input aria-label="New assignee" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Leave blank to unassign" className="crm-input mt-1" />
        </label>
                  {error ? <p role="alert" className="text-sm font-semibold text-cui-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} disabled={saving} className="crm-button">Cancel</button>
          <button type="submit" disabled={saving} className="crm-button-primary">{saving ? 'Saving...' : 'Save assignment'}</button>
        </div>
      </form>
    </TaskDialogShell>
  );
}
