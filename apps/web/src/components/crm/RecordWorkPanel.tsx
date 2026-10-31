'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, Pin } from 'lucide-react';
import { isNoteKind, type NoteKind, type RecordTarget, type WorkspaceNote, type WorkspaceTask } from '@crm/shared';
import { arizonaDateTimeInput, arizonaInputToIso, formatArizonaDateTime } from '../../lib/arizona-time';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import { useNotifications } from '../../context/NotificationContext';
import RecordHistory from './RecordHistory';

interface Props {
  target: RecordTarget;
  name: string;
  section: 'notes' | 'tasks';
  compose?: { kind: 'note' | 'reminder'; token: number };
  refreshToken?: number;
  onChanged: () => void;
  onTaskCount?: (count: number) => void;
}

const noteLabels: Record<NoteKind, string> = { general: 'General', call: 'Call', underwriting: 'Underwriting', service: 'Service' };
const inputClass = 'mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text';

export default function RecordWorkPanel({ target, name, section, compose, refreshToken = 0, onChanged, onTaskCount }: Props): JSX.Element {
  const { refresh } = useNotifications();
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'note' | 'reminder' | null>(null);
  const [note, setNote] = useState('');
  const [noteKind, setNoteKind] = useState<NoteKind>('call');
  const [alsoRemind, setAlsoRemind] = useState(false);
  const [action, setAction] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [editingNote, setEditingNote] = useState<WorkspaceNote | null>(null);
  const [editingTask, setEditingTask] = useState<WorkspaceTask | null>(null);
  const [view, setView] = useState<'open' | 'completed'>('open');
  const [busy, setBusy] = useState(false);
  const saveId = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const countCallback = useRef(onTaskCount);
  countCallback.current = onTaskCount;
  const query = `record_type=${target.type}&record_id=${target.id}`;

  const load = useCallback(async (): Promise<void> => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [loadedNotes, loadedTasks] = await Promise.all([
        workspacePages<WorkspaceNote>(`/api/interactions?${query}`, 100, 'page'),
        workspacePages<WorkspaceTask>(`/api/tasks?${query}&status=all&sort=due_asc&limit=200&include=related`, 200, 'offset'),
      ]);
      if (version !== loadVersion.current) return;
      setNotes(loadedNotes);
      setTasks(loadedTasks);
      countCallback.current?.(loadedTasks.filter((task) => task.status === 'open').length);
      setError(null);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Unable to load notes and tasks.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => {
    if (compose) {
      setEditingNote(null); setEditingTask(null); setMode(compose.kind);
      saveId.current = null;
    }
  }, [compose?.kind, compose?.token]);

  const reset = (): void => {
    setMode(null); setNote(''); setAlsoRemind(false); setAction(''); setDue('');
    setDescription(''); setPriority('medium'); setEditingNote(null); setEditingTask(null);
    saveId.current = null;
  };

  const afterSave = async (): Promise<void> => {
    await load();
    await refresh();
    onChanged();
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const reminderNeeded = mode === 'reminder' || alsoRemind;
    const dueIso = reminderNeeded ? arizonaInputToIso(due) : null;
    if (reminderNeeded && (!action.trim() || !dueIso)) { setError('Describe the action and choose a valid Arizona date and time.'); return; }
    if (mode === 'note' && !note.trim()) { setError('Enter the note before saving.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      saveId.current ??= crypto.randomUUID();
      if (mode === 'note') {
        await workspaceFetch('/api/interactions', {
          method: editingNote ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingNote?.id ?? saveId.current,
            [target.type === 'lead' ? 'lead_id' : 'client_id']: target.id,
            content: note, note_type: noteKind, expected_updated_at: editingNote?.updated_at,
            reminder: !editingNote && alsoRemind ? { subject: action, due_date: dueIso, priority } : undefined,
          }),
        });
        setNotice(alsoRemind ? 'Note and reminder saved together.' : 'Note saved to this account history.');
      } else {
        await workspaceFetch('/api/tasks', {
          method: editingTask ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingTask?.id ?? saveId.current, subject: action, due_date: dueIso,
            description, priority, kind: editingTask?.kind ?? 'reminder',
            related_type: target.type, related_id: target.id, expected_updated_at: editingTask?.updated_at,
          }),
        });
        setNotice('Reminder saved. It is linked to this profile, Tasks and the dashboard; the bell will alert when it is due.');
      }
      reset();
      await afterSave();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save your work.');
    } finally {
      setBusy(false);
    }
  };

  const patchTask = async (task: WorkspaceTask, status: 'open' | 'completed'): Promise<void> => {
    setBusy(true); setNotice(null);
    try {
      await workspaceFetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status, expected_updated_at: task.updated_at }) });
      setNotice(status === 'completed' ? 'Task completed. Use Completed to reopen it if needed.' : 'Task reopened.');
      await afterSave();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update this task.');
    } finally { setBusy(false); }
  };

  const pin = async (item: WorkspaceNote): Promise<void> => {
    setBusy(true);
    try {
      await workspaceFetch('/api/interactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, pinned: !item.pinned, expected_updated_at: item.updated_at,
          [target.type === 'lead' ? 'lead_id' : 'client_id']: target.id }) });
      await afterSave();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to pin this note.'); }
    finally { setBusy(false); }
  };

  const visibleTasks = tasks.filter((task) => view === 'open' ? task.status === 'open' : task.status === 'completed')
    .sort((left, right) => view === 'completed'
      ? new Date(right.completed_at ?? right.created_at).getTime() - new Date(left.completed_at ?? left.created_at).getTime()
      : new Date(left.due_date ?? '9999-01-01').getTime() - new Date(right.due_date ?? '9999-01-01').getTime());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-bold text-cui-text">{section === 'notes' ? 'Notes & history' : 'Tasks & reminders'}</h3>
          <p className="text-xs text-cui-muted">For {name}. Saved work stays attached when the lead is linked to a client account.</p></div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => { setEditingNote(null); setEditingTask(null); setMode('note'); saveId.current = null; }}
            className="rounded border border-cui-primary px-3 py-1.5 text-sm font-semibold text-cui-primary">Add note</button>
          <button type="button" disabled={busy} onClick={() => { setEditingNote(null); setEditingTask(null); setMode('reminder'); saveId.current = null; }}
            className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white">Add reminder</button>
        </div>
      </div>
      {error ? <div role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{error} <button type="button" onClick={() => void load()} className="font-semibold underline">Refresh</button></div> : null}
      {notice ? <p role="status" className="rounded bg-cui-success/10 p-3 text-sm text-cui-text">{notice}</p> : null}
      {mode ? (
        <form onSubmit={(event) => void save(event)} className="space-y-3 rounded border border-cui-border bg-white p-3">
          <h4 className="font-semibold text-cui-text">{mode === 'note' ? editingNote ? 'Edit note' : 'Add note' : editingTask ? 'Edit / reschedule task' : 'Add reminder'}</h4>
          {mode === 'note' ? (
            <>
              <label className="block text-xs font-semibold text-cui-muted">Note type
                <select value={noteKind} onChange={(event) => { if (isNoteKind(event.target.value)) setNoteKind(event.target.value); }} className={inputClass}>
                  {Object.entries(noteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-cui-muted">Note
                <textarea required autoFocus maxLength={20000} value={note} onChange={(event) => setNote(event.target.value)}
                  placeholder="What they told you, decisions, missing information..." className={`${inputClass} min-h-28`} />
              </label>
              {!editingNote ? <label className="flex items-center gap-2 text-sm text-cui-text"><input type="checkbox" checked={alsoRemind} onChange={(event) => setAlsoRemind(event.target.checked)} />Also create a reminder</label> : null}
            </>
          ) : null}
          {mode === 'reminder' || alsoRemind ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-cui-muted sm:col-span-2">Action to take
                <input required autoFocus={mode === 'reminder'} maxLength={200} value={action} onChange={(event) => setAction(event.target.value)}
                  placeholder="Call to confirm truck VINs, request roof details..." className={inputClass} />
              </label>
              <label className="text-xs font-semibold text-cui-muted">Date and time - Arizona (UTC-7)
                <input required type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-semibold text-cui-muted">Priority
                <select value={priority} onChange={(event) => setPriority(event.target.value)} className={inputClass}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </label>
              {mode === 'reminder' ? <label className="text-xs font-semibold text-cui-muted sm:col-span-2">Details (optional)
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} min-h-16`} />
              </label> : null}
              <p className="text-xs text-cui-muted sm:col-span-2">Creates an in-app reminder, not an email or text to the client. No AI credits are used.</p>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : mode === 'note' ? alsoRemind ? 'Save note & reminder' : 'Save note' : 'Save reminder'}</button>
            <button type="button" disabled={busy} onClick={reset} className="rounded border border-cui-border px-3 py-1.5 text-sm text-cui-muted">Cancel</button>
          </div>
        </form>
      ) : null}
      {loading ? <p className="text-sm text-cui-muted">Loading saved work...</p> : null}
      {section === 'notes' ? (
        <div className="space-y-2">
          {!loading && !notes.length && !error ? <p className="text-sm text-cui-muted">No notes yet.</p> : null}
          {notes.map((item) => (
            <article key={item.id} className={`rounded border bg-white p-3 ${item.pinned ? 'border-cui-primary/50' : 'border-cui-border'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-cui-muted">{item.pinned ? <Pin className="h-3 w-3 text-cui-primary" /> : null}{noteLabels[item.note_type] ?? 'General'} note</p>
                <div className="flex gap-2 text-xs font-semibold text-cui-primary">
                  <button type="button" disabled={busy} onClick={() => void pin(item)}>{item.pinned ? 'Unpin' : 'Pin'}</button>
                  <button type="button" disabled={busy} onClick={() => { setEditingNote(item); setEditingTask(null); setNote(item.content); setNoteKind(item.note_type); setAlsoRemind(false); setMode('note'); }}>Edit</button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-cui-text">{item.content}</p>
              <p className="mt-2 text-[11px] text-cui-muted">{formatArizonaDateTime(item.created_at)} AZ | {item.author_name || 'Author not recorded (legacy)'}</p>
              {item.updated_at !== item.created_at ? <p className="text-[11px] text-cui-muted">Edited {formatArizonaDateTime(item.updated_at)} AZ{item.updated_by ? ` by ${item.updated_by}` : ''}. Earlier text is retained in the activity history.</p> : null}
              {tasks.filter((task) => task.note_id === item.id).map((task) => <p key={task.id} className="mt-1 text-xs text-cui-primary">Reminder: {task.subject} | {task.status} | {formatArizonaDateTime(task.due_date)} AZ</p>)}
              <RecordHistory target={target} itemId={item.id} table="interactions" />
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-cui-border">
            {(['open', 'completed'] as const).map((value) => <button key={value} type="button" onClick={() => setView(value)}
              className={`border-b-2 px-3 py-1.5 text-sm font-semibold ${view === value ? 'border-cui-primary text-cui-primary' : 'border-transparent text-cui-muted'}`}>
              {value === 'open' ? 'Open' : 'Completed'} ({tasks.filter((task) => task.status === value).length})
            </button>)}
          </div>
          {!loading && !visibleTasks.length && !error ? <p className="text-sm text-cui-muted">{view === 'open' ? 'No open tasks or reminders.' : 'No completed tasks yet.'}</p> : null}
          {visibleTasks.map((task) => (
            <article key={task.id} className="rounded border border-cui-border bg-white p-3">
              <div className="flex items-start gap-2">
                <button type="button" disabled={busy} onClick={() => void patchTask(task, view === 'open' ? 'completed' : 'open')}
                  aria-label={`${view === 'open' ? 'Complete' : 'Reopen'} ${task.subject}`} className="mt-0.5 text-cui-primary disabled:opacity-50">
                  {view === 'open' ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-cui-success" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`break-words text-sm font-semibold text-cui-text ${view === 'completed' ? 'line-through' : ''}`}>{task.subject}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-cui-muted">{task.kind === 'reminder' ? <Clock className="h-3 w-3" /> : null}{task.kind === 'reminder' ? 'Reminder' : 'Task'} | {formatArizonaDateTime(task.due_date)} AZ | {task.priority} priority</p>
                  {task.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-cui-text">{task.description}</p> : null}
                  {view === 'completed' ? <p className="mt-1 text-xs text-cui-muted">{task.completed_at ? `Completed ${formatArizonaDateTime(task.completed_at)} AZ` : 'Completion time not recorded (legacy)'}</p> : null}
                </div>
                <button type="button" disabled={busy} onClick={() => {
                  if (view === 'completed') { void patchTask(task, 'open'); return; }
                  setEditingTask(task); setEditingNote(null); setAction(task.subject); setDue(task.due_date ? arizonaDateTimeInput(task.due_date) : '');
                  setPriority(task.priority); setDescription(task.description ?? ''); setMode('reminder'); setAlsoRemind(false);
                }} className="shrink-0 text-xs font-semibold text-cui-primary disabled:opacity-50">{view === 'completed' ? 'Reopen' : 'Edit / reschedule'}</button>
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
