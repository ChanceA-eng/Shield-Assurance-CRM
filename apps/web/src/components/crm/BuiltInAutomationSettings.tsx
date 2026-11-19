'use client';

import { useCallback, useEffect, useState } from 'react';
import { AUTOMATION_RULE_INVENTORY, validateAutomationConfiguration, type BuiltInAutomationDefaults, type BuiltInAutomationId } from '@crm/shared';
import type { AutomationSettingsSnapshot } from '../../lib/automation-settings';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

interface Field { key: string; label: string; min?: number; max?: number; options?: string[] }
type NotificationSettings = BuiltInAutomationDefaults['notifications'] & { task_reminders: boolean };
const notificationSettings = (policy: BuiltInAutomationDefaults): NotificationSettings => ({
  ...policy.notifications, task_reminders: policy.reminders.enabled,
});
const fields: Record<BuiltInAutomationId, Field[]> = {
  intake: [
    { key: 'enabled', label: 'Create first-contact tasks' },
    { key: 'due_hour', label: 'Due hour - Arizona', min: 0, max: 23 },
    { key: 'warm_priority', label: 'Website / warm priority', options: ['low', 'medium', 'high'] },
    { key: 'cold_priority', label: 'Imported / cold priority', options: ['low', 'medium', 'high'] },
    { key: 'cold_next_business_day', label: 'Cold leads: start next business day' },
  ],
  follow_up: [
    { key: 'enabled', label: 'Create missing pipeline follow-ups' },
    { key: 'statuses', label: 'Eligible stages', options: ['new', 'contacted', 'quoted', 'negotiation'] },
    { key: 'due_hour', label: 'Next business-day due hour - Arizona', min: 0, max: 23 },
    { key: 'priority', label: 'Task priority', options: ['low', 'medium', 'high'] },
  ],
  reply: [
    { key: 'enabled', label: 'Create and reconcile reply tasks' },
    { key: 'due_minutes', label: 'Reply target - minutes', min: 5, max: 10080 },
    { key: 'complete_on_successful_send', label: 'Complete reply task after a successful email or text' },
  ],
  renewal: [
    { key: 'enabled', label: 'Run renewal radar' },
    { key: 'window_days', label: 'Start review - days before renewal', min: 1, max: 365 },
    { key: 'grace_days', label: 'Keep lapsed renewals - days after', min: 0, max: 90 },
    { key: 'task_days_before', label: 'Task due - days before renewal', min: 0, max: 365 },
    { key: 'urgent_days_before', label: 'High priority - days before renewal', min: 0, max: 365 },
    { key: 'milestones', label: 'Notification milestones - descending days, ending at 0' },
  ],
  import_renewal: [
    { key: 'tasks_enabled', label: 'Create renewal verification tasks for imported leads' },
    { key: 'task_days_before', label: 'Schedule before reported renewal - days', min: 0, max: 365 },
  ],
  sequence: [
    { key: 'total_steps', label: 'Emails per new sequence', min: 1, max: 10 },
    { key: 'step_gap_days', label: 'Days between emails', min: 1, max: 60 },
  ],
  reminders: [{ key: 'enabled', label: 'Notify when reminders become due' }],
  notifications: [
    { key: 'service_events', label: 'Notify on claim, endorsement and certificate work' },
    { key: 'renewals', label: 'Notify on policy renewal milestones' },
    { key: 'message_replies', label: 'Notify on incoming client replies' },
  ],
  service: [
    { key: 'tasks_enabled', label: 'Create and reconcile service-request tasks' },
    { key: 'acknowledgment_email_enabled', label: 'Send consented claim, endorsement and certificate acknowledgments' },
  ],
};
const control = 'crm-input block h-9 max-sm:h-11';

export default function BuiltInAutomationSettings({ sequences = false }: { sequences?: boolean }): JSX.Element {
  const [configuration, setConfiguration] = useState<BuiltInAutomationDefaults | null>(null);
  const [savedNotifications, setSavedNotifications] = useState<NotificationSettings | null>(null);
  const [notificationChangeConfirmed, setNotificationChangeConfirmed] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [selected, setSelected] = useState<BuiltInAutomationId>(sequences ? 'sequence' : 'intake');
  const [milestones, setMilestones] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const notificationsChanged = Boolean(configuration && savedNotifications
    && (configuration.notifications.service_events !== savedNotifications.service_events
      || configuration.notifications.renewals !== savedNotifications.renewals
      || configuration.notifications.message_replies !== savedNotifications.message_replies
      || configuration.reminders.enabled !== savedNotifications.task_reminders));
  const load = useCallback(async (): Promise<void> => {
    const data = await workspaceFetch<{ revision: number; configuration: AutomationSettingsSnapshot }>('/api/settings/automation');
    const policy = validateAutomationConfiguration(data.configuration.automation);
    setConfiguration(policy); setRevision(data.revision); setMilestones(policy.renewal.milestones.join(', '));
    setSavedNotifications(notificationSettings(policy)); setNotificationChangeConfirmed(false);
    setDirty(false); setError('');
  }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Automation settings could not load.')); }, [load]);
  useUnsavedChanges(dirty);
  const change = (field: string, value: boolean | number | string | string[]): void => {
    setConfiguration((current) => current ? { ...current, [selected]: { ...current[selected], [field]: value } } : current);
    if (selected === 'notifications' || selected === 'reminders') setNotificationChangeConfirmed(false);
    setDirty(true); setNotice('');
  };
  const changeServiceTemplate = (kind: 'claim' | 'endorsement' | 'certificate', field: 'subject' | 'description', value: string): void => {
    setConfiguration((current) => current ? { ...current, service: { ...current.service, task_templates: {
      ...current.service.task_templates, [kind]: { ...current.service.task_templates[kind], [field]: value },
    } } } : current);
    setDirty(true); setNotice('');
  };
  const reload = (): void => {
    if (dirty && !window.confirm('Reload saved settings and discard your unsaved changes?')) return;
    setBusy(true);
    void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Settings could not reload.')).finally(() => setBusy(false));
  };
  const save = async (): Promise<void> => {
    if (!configuration || revision === null) return;
    if (notificationsChanged && !notificationChangeConfirmed) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!/^\s*\d+\s*(,\s*\d+\s*)*$/.test(milestones)) throw new Error('Enter renewal milestones separated by commas.');
      const policy = validateAutomationConfiguration({ ...configuration, renewal: {
        ...configuration.renewal, milestones: milestones.split(',').map((value) => Number(value.trim())),
      } });
      const saved = await workspaceFetch<{ revision: number }>('/api/settings/automation', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: revision, configuration: policy }),
      });
      setConfiguration(policy); setSavedNotifications(notificationSettings(policy)); setRevision(saved.revision);
      setNotificationChangeConfirmed(false); setDirty(false); setNotice('Automation settings saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Automation settings could not save.'); }
    finally { setBusy(false); }
  };
  if (!configuration) return <div>
    {error ? <p role="alert" className="mb-2 text-sm text-cui-danger">{error}</p> : <p className="text-sm text-cui-muted">Loading settings...</p>}
    {error ? <button onClick={reload} disabled={busy} className="text-sm font-semibold text-cui-primary underline">Retry loading</button> : null}
  </div>;
  const values = new Map(Object.entries<unknown>(configuration[selected]));
  const label = AUTOMATION_RULE_INVENTORY.find((rule) => rule.id === selected)?.label;
  const rules = AUTOMATION_RULE_INVENTORY.filter((rule) => rule.id !== 'sequence');
  return <div className={sequences ? '' : 'grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(0,1.7fr)]'}>
    {!sequences ? <Card><CardBody className="p-0">
      <table className="w-full text-left text-sm"><thead className="bg-cui-body/40 text-xs text-cui-muted">
        <tr><th className="px-3 py-2">Rule</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"><span className="sr-only">Edit</span></th></tr>
      </thead><tbody>{rules.map((rule) => {
        const policy = configuration[rule.id];
        const enabled = 'enabled' in policy ? policy.enabled : 'tasks_enabled' in policy
          ? policy.tasks_enabled || ('acknowledgment_email_enabled' in policy && policy.acknowledgment_email_enabled)
          : Object.values(policy).some((value) => value === true);
        return <tr key={rule.id} className={`border-t border-cui-border ${selected === rule.id ? 'bg-cui-primary/5' : ''}`}>
          <th className="px-3 py-3 font-medium">{rule.label}</th>
          <td className="px-3 py-3"><span className={`rounded px-2 py-0.5 text-xs ${enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{enabled ? 'On' : 'Paused'}</span></td>
          <td className="px-3 py-3"><button disabled={busy} aria-label={`Edit ${rule.label}`} aria-pressed={selected === rule.id}
            onClick={() => setSelected(rule.id)} className="font-semibold text-cui-primary">Edit</button></td>
        </tr>;
      })}</tbody></table>
    </CardBody></Card> : null}
    <Card><CardHeader>{label}</CardHeader><CardBody>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          {fields[selected].map((field) => {
            const value = values.get(field.key);
            const id = `automation-${selected}-${field.key}`;
            if (typeof value === 'boolean') return <label key={field.key} htmlFor={id} className="flex min-h-9 items-center gap-2 text-sm">
              <input id={id} type="checkbox" checked={value} onChange={(event) => change(field.key, event.target.checked)} />{field.label}
            </label>;
            if (Array.isArray(value) && field.key === 'statuses') return <fieldset key={field.key}><legend className="mb-2 text-xs font-semibold text-cui-muted">{field.label}</legend>
              <div className="flex flex-wrap gap-4">{field.options?.map((option) => <label key={option} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value.includes(option)} onChange={(event) => change(field.key, event.target.checked
                  ? [...configuration.follow_up.statuses, option] : configuration.follow_up.statuses.filter((status) => status !== option))} />{option}
              </label>)}</div>
            </fieldset>;
            return <div key={field.key}><label htmlFor={id} className="mb-1 block text-xs font-semibold text-cui-muted">{field.label}</label>
              {field.options ? <select id={id} className={control} value={String(value)} onChange={(event) => change(field.key, event.target.value)}>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select> : field.key === 'milestones' ? <input id={id} className={control} value={milestones}
                onChange={(event) => { setMilestones(event.target.value); setDirty(true); setNotice(''); }} /> : <input id={id} className={control}
                required type="number" step={1} min={field.min} max={field.max} value={typeof value === 'number' && Number.isNaN(value) ? '' : String(value)}
                onChange={(event) => change(field.key, event.target.valueAsNumber)} />}
            </div>;
          })}
          {selected === 'service' ? <fieldset className="space-y-3 rounded border border-cui-border p-3">
            <legend className="px-1 text-xs font-bold text-cui-muted">Internal task wording</legend>
            {(['claim', 'endorsement', 'certificate'] as const).map((kind) => <div key={kind} className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold capitalize text-cui-muted">{kind} subject
                <input className={control} maxLength={240} value={configuration.service.task_templates[kind].subject}
                  onChange={(event) => changeServiceTemplate(kind, 'subject', event.target.value)} />
              </label>
              <label className="text-xs font-semibold capitalize text-cui-muted">{kind} instructions
                <textarea className="mt-1 min-h-20 w-full rounded border border-cui-border bg-white p-2 text-sm focus:border-cui-primary focus:outline-none focus:ring-2 focus:ring-cui-primary/20"
                  maxLength={2000} value={configuration.service.task_templates[kind].description}
                  onChange={(event) => changeServiceTemplate(kind, 'description', event.target.value)} />
              </label>
            </div>)}
            <p className="text-xs text-cui-muted">Supported subject placeholders: {'{service_type}'} and {'{account_name}'}.</p>
          </fieldset> : null}
          {notificationsChanged ? <div className="space-y-2 rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            <p className="font-bold">Warning: this changes future agency-wide in-app alerts, including due-task reminders.</p>
            <p>Existing alerts and website-submission requests remain visible. Re-enabling a switch will not replay past alerts.</p>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" checked={notificationChangeConfirmed} onChange={(event) => setNotificationChangeConfirmed(event.target.checked)} />
              I understand these notification changes affect future alerts only.
            </label>
          </div> : null}
          {error ? <div><p role="alert" className="text-sm text-cui-danger">{error}</p><button type="button" onClick={reload} className="mt-1 text-sm font-semibold text-cui-primary underline">Reload saved settings</button></div> : null}
          {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
          <div className="flex justify-end"><button disabled={!dirty || busy || (notificationsChanged && !notificationChangeConfirmed)} className="h-9 rounded bg-cui-primary px-4 text-sm font-semibold text-white disabled:opacity-50 max-sm:h-11">{busy ? 'Saving...' : 'Save automation'}</button></div>
        </fieldset>
      </form>
    </CardBody></Card>
  </div>;
}
