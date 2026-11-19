'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CRM_WORKFLOW_ACTIONS, CRM_WORKFLOW_EVENTS, parseWorkflowRule, validateWorkflowDefinition,
  type CrmWorkflowDefinition, type CrmWorkflowRule } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

interface RuleData {
  items: CrmWorkflowRule[]; selected_rule: CrmWorkflowRule | null; total: number; page: number; page_size: number;
  members: Array<{ user_id: string; email: string; role: string }>;
  history: Array<{ revision: number; recorded_at: string }>;
  executions: Array<{ id: string; rule_id: string; rule_revision: number; status: string; finished_at: string | null; error: string | null }>;
}
interface WorkflowBacklogPreview {
  rule_id: string; rule_revision: number; event: string; action_type: string;
  eligible_count: number; fingerprint: string; batch_limit: number; may_use_ai: boolean;
}
interface WorkflowBacklogResult { queued_count: number; skipped_count: number; remaining_count: number; rule_revision: number; preview_only: false }
const blank = (): CrmWorkflowDefinition => ({ schema_version: 1, name: '', event: 'lead.created', active: false,
  conditions: { sources: [], stages: [], statuses: [], lines: [], assignee: null },
  action: { type: 'create_task', content: '', delay_minutes: 0, priority: 'medium', assignee: null } });
const eventNames: Record<CrmWorkflowDefinition['event'], string> = {
  'lead.created': 'Lead created', 'lead.stage_changed': 'Pipeline stage changed', 'website.submitted': 'Website submission',
  'message.received': 'Incoming email or text', 'service.changed': 'Service request created or status changed',
  'policy.changed': 'Policy created, status or renewal date changed', 'renewal.milestone': 'Renewal milestone reached',
  'reminder.due': 'Reminder due', 'outreach.drafted': 'Outreach draft created', 'outreach.accepted': 'Outreach accepted for delivery',
  'outreach.blocked': 'Outreach delivery blocked or uncertain',
};
const actionNames: Record<CrmWorkflowDefinition['action']['type'], string> = {
  create_task: 'Create task', notify: 'Agency notification', create_note: 'Add account or lead note',
  enroll_sequence: 'Enroll in outreach - no first draft', draft_sequence: 'Enroll and draft - manual approval',
};
const control = 'crm-input h-9 max-sm:h-11';
const button = 'h-9 rounded border border-cui-border px-3 text-sm font-semibold text-cui-primary disabled:opacity-50 max-sm:h-11';
const listFields = [['sources', 'Sources'], ['stages', 'Pipeline stages'], ['statuses', 'Record statuses'], ['lines', 'Lines of business']] as const;
const backlogEvents: CrmWorkflowDefinition['event'][] = ['lead.created', 'lead.stage_changed', 'website.submitted'];

export default function CustomWorkflowSettings({ selection }: { selection?: { rule: string | null; page: string } } = {}): JSX.Element {
  const params = useSearchParams();
  const selectedId = selection ? selection.rule : params.get('rule');
  const page = selection ? selection.page : params.get('page') ?? '0';
  const [data, setData] = useState<RuleData | null>(null);
  const [selected, setSelected] = useState<CrmWorkflowRule | null>(null);
  const [draft, setDraft] = useState<CrmWorkflowDefinition>(blank);
  const [lists, setLists] = useState<Record<typeof listFields[number][0], string>>({ sources: '', stages: '', statuses: '', lines: '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backlog, setBacklog] = useState<WorkflowBacklogPreview | null>(null);
  const install = (rule: CrmWorkflowRule | null): void => {
    const definition = rule?.definition ?? blank();
    setSelected(rule); setDraft(definition); setDirty(false);
    setBacklog(null);
    setLists({ sources: definition.conditions.sources.join(', '), stages: definition.conditions.stages.join(', '),
      statuses: definition.conditions.statuses.join(', '), lines: definition.conditions.lines.join(', ') });
  };
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const query = new URLSearchParams({ page });
    if (selectedId) query.set('rule', selectedId);
    const result = await workspaceFetch<RuleData>(`/api/settings/automation/rules?${query}`, { signal });
    setData(result); install(result.selected_rule); setError('');
  }, [page, selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void load(controller.signal).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Custom rules could not load.');
    });
    return () => controller.abort();
  }, [load]);
  useUnsavedChanges(dirty);
  const edit = (definition: CrmWorkflowDefinition): void => { setDraft(definition); setDirty(true); setNotice(''); };
  const reload = async (): Promise<void> => {
    if (dirty && !window.confirm('Reload the saved rule and discard your unsaved changes?')) return;
    setBusy(true); setNotice('');
    try { await load(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Rule could not reload.'); }
    finally { setBusy(false); }
  };
  const save = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try {
      const values = (value: string): string[] => value.trim() ? value.split(',').map((part) => part.trim()) : [];
      const definition = validateWorkflowDefinition({ ...draft, conditions: { ...draft.conditions,
        sources: values(lists.sources), stages: values(lists.stages), statuses: values(lists.statuses), lines: values(lists.lines) } });
      const saved = parseWorkflowRule(await workspaceFetch<unknown>('/api/settings/automation/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_id: selected?.id ?? null, expected_revision: selected?.revision ?? 0, definition }),
      }));
      install(saved);
      const query = new URLSearchParams({ page, rule: saved.id });
      window.history.replaceState(null, '', `/settings?tab=automation&section=rules&rules=custom&${query}`);
      setNotice(`"${saved.definition.name}" saved - revision ${saved.revision}. ${saved.definition.active ? 'New events only.' : 'Paused.'}`);
      if (selectedId === saved.id) setData(await workspaceFetch<RuleData>(`/api/settings/automation/rules?${query}`));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Rule could not save.'); }
    finally { setBusy(false); }
  };
  const previewBacklog = async (): Promise<void> => {
    if (!selected || dirty) return;
    setBusy(true); setError(''); setNotice(''); setBacklog(null);
    try {
      const result = await workspaceFetch<WorkflowBacklogPreview>(`/api/settings/automation/rules/backlog?rule=${encodeURIComponent(selected.id)}`);
      if (result.rule_id !== selected.id || result.rule_revision !== selected.revision || !Number.isSafeInteger(result.eligible_count)
        || !/^[0-9a-f]{32}$/.test(result.fingerprint)) throw new Error('Backlog preview changed or returned invalid eligibility. Reload the rule.');
      setBacklog(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Backlog preview could not load.'); }
    finally { setBusy(false); }
  };
  const queueBacklog = async (): Promise<void> => {
    if (!selected || !backlog || dirty || backlog.rule_id !== selected.id || backlog.rule_revision !== selected.revision) return;
    const batchSize = Math.min(backlog.eligible_count, backlog.batch_limit);
    const action = backlog.action_type === 'draft_sequence'
      ? 'A later, separately confirmed Custom Rules run may use AI to draft outreach, and any draft requires manual approval.'
      : backlog.action_type === 'enroll_sequence'
        ? 'A later, separately confirmed Custom Rules run may enroll consented leads; it will not create a first draft.'
        : 'A later, separately confirmed Custom Rules run may create the configured internal work.';
    if (!window.confirm(`Queue up to ${batchSize} of ${backlog.eligible_count} matching existing records for "${selected.definition.name}"? This only queues work; it does not create tasks, notes, notifications, enrollments, drafts, or send messages now. ${action}`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workspaceFetch<WorkflowBacklogResult>('/api/settings/automation/rules/backlog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_id: selected.id, expected_revision: backlog.rule_revision,
          eligible_count: backlog.eligible_count, fingerprint: backlog.fingerprint, confirmed: true }),
      });
      if (result.preview_only !== false || result.rule_revision !== selected.revision
        || !Number.isInteger(result.queued_count) || !Number.isInteger(result.remaining_count)) {
        throw new Error('Backlog queue result could not be verified. Reload the rule before continuing.');
      }
      setBacklog(null);
      setNotice(`Queued ${result.queued_count} existing record${result.queued_count === 1 ? '' : 's'}; ${result.remaining_count} remain for another preview. Work stays held until you explicitly run Custom Rules.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Backlog could not be queued.'); }
    finally { setBusy(false); }
  };
  const sequence = draft.action.type === 'enroll_sequence' || draft.action.type === 'draft_sequence';
  const href = (nextPage: number, rule?: string): `/settings?${string}` => `/settings?tab=automation&section=rules&rules=custom&page=${nextPage}${rule ? `&rule=${rule}` : ''}`;
  return <div className="space-y-3">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-cui-text">{notice}</p> : null}
    {!data ? <div className="flex items-center gap-3"><p className="text-sm text-cui-muted">{error ? 'Rules unavailable.' : 'Loading custom rules...'}</p>
      {error ? <button className={button} disabled={busy} onClick={() => void reload()}>Retry loading</button> : null}</div> : <>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1.7fr)]">
        <Card className="min-w-0"><CardHeader className="flex items-center justify-between gap-2">Custom rules
          <button className={button} disabled={busy} onClick={() => {
            if (dirty && !window.confirm('Discard unsaved changes and create a new rule?')) return;
            install(null); setNotice(''); setError('');
            window.history.replaceState(null, '', href(data.page));
          }}>New rule</button>
        </CardHeader><CardBody className="p-0">
          {data.items.length ? <ul>{data.items.map((rule) => <li key={rule.id} className="border-b border-cui-border last:border-0">
            <a href={href(data.page, rule.id)} aria-current={selected?.id === rule.id ? 'page' : undefined}
              className={`flex items-start justify-between gap-2 px-3 py-3 text-sm ${selected?.id === rule.id ? 'bg-cui-primary/5' : 'hover:bg-cui-body/30'}`}>
              <span className="min-w-0 break-words"><span className="font-semibold">{rule.definition.name}</span><span className="mt-1 block text-xs text-cui-muted">{eventNames[rule.definition.event]}</span></span>
              <span className={`rounded px-2 py-0.5 text-xs ${rule.definition.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{rule.definition.active ? 'On' : 'Paused'}</span>
            </a>
          </li>)}</ul> : <p className="p-3 text-sm text-cui-muted">No custom rules. Create one to start.</p>}
          {data.total > data.page_size ? <div className="flex items-center justify-between gap-2 border-t border-cui-border p-3 text-sm">
            {data.page > 0 ? <a href={href(data.page - 1, selected?.id)} className="text-cui-primary">Previous</a> : <span />}
            <span>Page {data.page + 1} of {Math.ceil(data.total / data.page_size)}</span>
            {(data.page + 1) * data.page_size < data.total ? <a href={href(data.page + 1, selected?.id)} className="text-cui-primary">Next</a> : <span />}
          </div> : null}
        </CardBody></Card>
        <Card className="min-w-0"><CardHeader>{selected ? 'Edit rule' : 'New rule'}</CardHeader><CardBody className="space-y-4 py-3">
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-cui-muted">Rule name<input className={`${control} mt-1`} maxLength={100}
                value={draft.name} onChange={(event) => edit({ ...draft, name: event.target.value })} /></label>
              <label className="flex items-center gap-2 self-end py-2 text-sm font-medium"><input type="checkbox" checked={draft.active}
                onChange={(event) => edit({ ...draft, active: event.target.checked })} />Enabled for new events</label>
              <label className="text-xs font-semibold text-cui-muted">When<select className={`${control} mt-1`} value={draft.event}
                onChange={(event) => {
                  const value = CRM_WORKFLOW_EVENTS.find((value) => value === event.target.value);
                  if (!value) return;
                  edit({ ...draft, event: value, action: sequence && !['lead.created', 'lead.stage_changed', 'website.submitted'].includes(value)
                    ? { type: 'create_task', content: '', delay_minutes: 0, priority: 'medium', assignee: null } : draft.action });
                }}>{CRM_WORKFLOW_EVENTS.map((value) => <option key={value} value={value}>{eventNames[value]}</option>)}</select></label>
              <label className="text-xs font-semibold text-cui-muted">Then<select className={`${control} mt-1`} value={draft.action.type}
                onChange={(event) => {
                  const type = CRM_WORKFLOW_ACTIONS.find((type) => type === event.target.value);
                  if (type) edit({ ...draft, action: { type, content: ['enroll_sequence', 'draft_sequence'].includes(type) ? '' : draft.action.content,
                    delay_minutes: 0, priority: 'medium', assignee: null } });
                }}>{CRM_WORKFLOW_ACTIONS.filter((type) => !['enroll_sequence', 'draft_sequence'].includes(type)
                  || ['lead.created', 'lead.stage_changed', 'website.submitted'].includes(draft.event))
                  .map((value) => <option key={value} value={value}>{actionNames[value]}</option>)}</select></label>
            </div>
            <details><summary className="cursor-pointer text-sm font-semibold text-cui-primary">Conditions</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{listFields.map(([key, label]) => <label key={key} className="text-xs font-semibold text-cui-muted">{label}
                <input className={`${control} mt-1`} value={lists[key]} placeholder={`Any ${label.toLowerCase()}`}
                  onChange={(event) => { setLists({ ...lists, [key]: event.target.value }); setDirty(true); setNotice(''); }} />
              </label>)}
                <label className="text-xs font-semibold text-cui-muted">Assigned member<select className={`${control} mt-1`} value={draft.conditions.assignee ?? ''}
                  onChange={(event) => edit({ ...draft, conditions: { ...draft.conditions, assignee: event.target.value || null } })}>
                  <option value="">Any member or unassigned</option>{data.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email} ({member.role})</option>)}
                </select></label>
              </div>
            </details>
            {!sequence ? <div className="text-xs text-cui-muted">
              <label htmlFor="workflow-action-content" className="font-semibold">{draft.action.type === 'create_task' ? 'Task title' : draft.action.type === 'notify' ? 'Notification' : 'Note'}</label>
              <textarea id="workflow-action-content" aria-describedby="workflow-action-hint" rows={draft.action.type === 'create_task' ? 2 : 3}
                className="mt-1 block w-full rounded border border-cui-border p-2 text-sm font-normal text-cui-text"
                maxLength={draft.action.type === 'create_task' ? 240 : draft.action.type === 'notify' ? 500 : 2000} value={draft.action.content}
                onChange={(event) => edit({ ...draft, action: { ...draft.action, content: event.target.value } })} />
              <p id="workflow-action-hint" className="mt-1">{'Use {{name}} for the account or lead name.'}</p>
            </div> : null}
            {draft.action.type === 'create_task' ? <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-cui-muted">Due after - minutes<input className={`${control} mt-1`} type="number" min={0} max={10080} step={1}
                value={Number.isNaN(draft.action.delay_minutes) ? '' : draft.action.delay_minutes}
                onChange={(event) => edit({ ...draft, action: { ...draft.action, delay_minutes: event.target.valueAsNumber } })} /></label>
              <label className="text-xs font-semibold text-cui-muted">Priority<select className={`${control} mt-1`} value={draft.action.priority}
                onChange={(event) => {
                  const priority = event.target.value;
                  if (priority === 'low' || priority === 'medium' || priority === 'high') edit({ ...draft, action: { ...draft.action, priority } });
                }}>{['low', 'medium', 'high'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="text-xs font-semibold text-cui-muted">Task assignee<select className={`${control} mt-1`} value={draft.action.assignee ?? ''}
                onChange={(event) => edit({ ...draft, action: { ...draft.action, assignee: event.target.value || null } })}>
                <option value="">Unassigned</option>{data.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email} ({member.role})</option>)}
              </select></label>
            </div> : null}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button className="h-9 rounded bg-cui-primary px-3 text-sm font-semibold text-white disabled:opacity-50 max-sm:h-11" disabled={busy || !dirty}
              onClick={() => void save()}>Save rule</button>
            <button className={button} disabled={busy} onClick={() => void reload()}>Reload saved rule</button>
            {selected ? <span className="text-xs text-cui-muted">Revision {selected.revision}</span> : null}
          </div>
          {selected && selected.definition.active && backlogEvents.includes(selected.definition.event) ? <section className="space-y-2 rounded border border-cui-border bg-cui-body/20 p-3" aria-label="Existing record backlog">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">Existing records</h3>
                <p className="text-xs text-cui-muted">Future events are automatic. Existing leads and unhandled website submissions require a separate preview and explicit queue action.</p></div>
              <button className={button} disabled={busy || dirty} onClick={() => void previewBacklog()}>Preview backlog</button>
            </div>
            {backlog ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cui-border pt-2">
              <p className="text-sm">{backlog.eligible_count} eligible; queue up to {Math.min(backlog.eligible_count, backlog.batch_limit)} in this batch.
                {backlog.may_use_ai ? ' The later explicit run may use AI; any generated draft requires approval.' : ' No AI or message sending occurs when queuing.'}</p>
              <button className="h-9 rounded bg-cui-primary px-3 text-sm font-semibold text-white disabled:opacity-50 max-sm:h-11"
                disabled={busy || backlog.eligible_count === 0} onClick={() => void queueBacklog()}>Queue backlog</button>
            </div> : null}
          </section> : null}
          {data.history.length ? <details><summary className="cursor-pointer text-sm font-semibold text-cui-primary">Revision history</summary>
            <ul className="mt-2 space-y-1 text-xs text-cui-muted">{data.history.map((version) => <li key={version.revision}>Revision {version.revision} - {formatArizonaDateTime(version.recorded_at)} AZ</li>)}</ul>
          </details> : null}
        </CardBody></Card>
      </div>
      <Card><CardHeader>Recent rule executions</CardHeader><CardBody className="overflow-x-auto p-0">
        {data.executions.length ? <table className="w-full text-left text-sm"><thead className="bg-cui-body/40 text-xs text-cui-muted"><tr>
          <th className="px-3 py-2">Rule</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Finished - AZ</th></tr></thead>
          <tbody>{data.executions.map((run) => <tr key={run.id} className="border-t border-cui-border">
            <td className="px-3 py-2"><a href={href(data.page, run.rule_id)} className="text-cui-primary">{data.items.find((rule) => rule.id === run.rule_id)?.definition.name ?? 'View rule'}</a>
              <span className="ml-2 text-xs text-cui-muted">v{run.rule_revision}</span></td>
            <td className="px-3 py-2">{run.status}{run.error ? <p className="mt-1 text-xs text-cui-danger">{run.error}</p> : null}</td>
            <td className="px-3 py-2 text-xs text-cui-muted">{run.finished_at ? formatArizonaDateTime(run.finished_at) : 'Pending'}</td>
          </tr>)}</tbody></table> : <p className="p-3 text-sm text-cui-muted">No executions recorded.</p>}
      </CardBody></Card>
    </>}
  </div>;
}
