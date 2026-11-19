export interface BuiltInAutomationDefaults {
  schema_version: 1;
  intake: { enabled: boolean; warm_priority: 'high' | 'medium' | 'low'; cold_priority: 'high' | 'medium' | 'low'; due_hour: number; cold_next_business_day: boolean };
  follow_up: { enabled: boolean; statuses: string[]; due_hour: number; priority: 'high' | 'medium' | 'low' };
  reply: { enabled: boolean; due_minutes: number; complete_on_successful_send: boolean };
  renewal: { enabled: boolean; window_days: number; grace_days: number; milestones: number[]; task_days_before: number; urgent_days_before: number };
  sequence: { total_steps: number; step_gap_days: number; auto_enroll_imports: boolean; auto_enroll_website: boolean };
  import_renewal: { tasks_enabled: boolean; task_days_before: number };
  reminders: { enabled: boolean };
  notifications: { service_events: boolean; renewals: boolean; message_replies: boolean };
  service: { tasks_enabled: boolean; acknowledgment_email_enabled: boolean; task_templates: Record<'claim' | 'endorsement' | 'certificate', { subject: string; description: string }> };
}

export const BUILT_IN_AUTOMATION_DEFAULTS: BuiltInAutomationDefaults = {
  schema_version: 1,
  intake: { enabled: true, warm_priority: 'high', cold_priority: 'medium', due_hour: 16, cold_next_business_day: true },
  follow_up: { enabled: true, statuses: ['new', 'contacted', 'quoted'], due_hour: 9, priority: 'medium' },
  reply: { enabled: true, due_minutes: 120, complete_on_successful_send: true },
  renewal: { enabled: true, window_days: 45, grace_days: 7, milestones: [45, 30, 15, 7, 0], task_days_before: 30, urgent_days_before: 15 },
  sequence: { total_steps: 3, step_gap_days: 5, auto_enroll_imports: false, auto_enroll_website: false },
  import_renewal: { tasks_enabled: true, task_days_before: 60 },
  reminders: { enabled: true },
  notifications: { service_events: true, renewals: true, message_replies: true },
  service: {
    tasks_enabled: true, acknowledgment_email_enabled: true,
    task_templates: {
      claim: { subject: 'Review {service_type}: {account_name}', description: 'Automatically queued from the source record. Resolve the request in its linked record.' },
      endorsement: { subject: 'Review {service_type}: {account_name}', description: 'Automatically queued from the source record. Resolve the request in its linked record.' },
      certificate: { subject: 'Review {service_type}: {account_name}', description: 'Automatically queued from the source record. Resolve the request in its linked record.' },
    },
  },
};

export type BuiltInAutomationId = Exclude<keyof BuiltInAutomationDefaults, 'schema_version'>;

export function validateAutomationConfiguration(value: unknown): BuiltInAutomationDefaults {
  const record = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a complete automation configuration.');
    return input as Record<string, unknown>;
  };
  const input = record(value);
  const exactKeys = (actual: Record<string, unknown>, baseline: Record<string, unknown>): void => {
    if (Object.keys(actual).length !== Object.keys(baseline).length || Object.keys(actual).some((key) => !Object.hasOwn(baseline, key))) {
      throw new Error('An unsupported automation setting was supplied.');
    }
  };
  exactKeys(input, record(BUILT_IN_AUTOMATION_DEFAULTS));
  if (input.schema_version !== 1) throw new Error('This automation configuration version is not supported.');
  for (const key of Object.keys(BUILT_IN_AUTOMATION_DEFAULTS).filter((key) => key !== 'schema_version')) {
    const group = record(input[key]);
    const baseline = record(record(BUILT_IN_AUTOMATION_DEFAULTS)[key]);
    exactKeys(group, baseline);
    for (const [field, original] of Object.entries(baseline)) {
      if (typeof original === 'boolean' && typeof group[field] !== 'boolean') throw new Error(`Choose whether ${key.replace('_', ' ')} ${field.replaceAll('_', ' ')} is enabled.`);
    }
  }
  const intake = record(input.intake), follow = record(input.follow_up), reply = record(input.reply);
  const renewal = record(input.renewal), sequence = record(input.sequence), importRenewal = record(input.import_renewal);
  const service = record(input.service), serviceTemplates = record(service.task_templates);
  const integer = (group: Record<string, unknown>, field: string, min: number, max: number): void => {
    if (typeof group[field] !== 'number' || !Number.isInteger(group[field]) || group[field] < min || group[field] > max) {
      throw new Error(`${field.replaceAll('_', ' ')} must be a whole number between ${min} and ${max}.`);
    }
  };
  integer(intake, 'due_hour', 0, 23); integer(follow, 'due_hour', 0, 23);
  for (const priority of [intake.warm_priority, intake.cold_priority, follow.priority]) {
    if (!['low', 'medium', 'high'].includes(String(priority))) throw new Error('Choose a supported task priority.');
  }
  if (!Array.isArray(follow.statuses) || !follow.statuses.length || new Set(follow.statuses).size !== follow.statuses.length
    || follow.statuses.some((status) => !['new', 'contacted', 'quoted', 'negotiation'].includes(status))) throw new Error('Choose valid pipeline stages without duplicates.');
  integer(reply, 'due_minutes', 5, 10080);
  integer(renewal, 'window_days', 1, 365); integer(renewal, 'grace_days', 0, 90);
  integer(renewal, 'task_days_before', 0, 365); integer(renewal, 'urgent_days_before', 0, 365);
  if (Number(renewal.task_days_before) > Number(renewal.window_days) || Number(renewal.urgent_days_before) > Number(renewal.window_days)) {
    throw new Error('Renewal task and urgent offsets must fit within the renewal window.');
  }
  if (!Array.isArray(renewal.milestones) || !renewal.milestones.length || renewal.milestones.length > 12
    || renewal.milestones.some((days, index, values) => typeof days !== 'number' || !Number.isInteger(days) || days < 0
      || days > Number(renewal.window_days) || (index > 0 && days >= values[index - 1]))
    || renewal.milestones[renewal.milestones.length - 1] !== 0) throw new Error('Renewal milestones must decrease, fit the window and end at 0.');
  integer(sequence, 'total_steps', 1, 10); integer(sequence, 'step_gap_days', 1, 60);
  integer(importRenewal, 'task_days_before', 0, 365);
  exactKeys(serviceTemplates, record(record(BUILT_IN_AUTOMATION_DEFAULTS.service).task_templates));
  for (const kind of ['claim', 'endorsement', 'certificate'] as const) {
    const template = record(serviceTemplates[kind]);
    exactKeys(template, { subject: '', description: '' });
    const subject = template.subject, description = template.description;
    for (const [field, max] of [['subject', 240], ['description', 2000]] as const) {
      const text = field === 'subject' ? subject : description;
      if (typeof text !== 'string' || !text.trim() || text.length > max
        || text.replaceAll('{service_type}', '').replaceAll('{account_name}', '').includes('{')
        || text.replaceAll('{service_type}', '').replaceAll('{account_name}', '').includes('}')) {
        throw new Error(`Enter valid ${kind} task ${field} using only the supported placeholders.`);
      }
    }
    if (typeof subject !== 'string' || !subject.includes('{service_type}') || !subject.includes('{account_name}')) {
      throw new Error(`The ${kind} task subject must include {service_type} and {account_name}.`);
    }
  }
  if (sequence.auto_enroll_imports || sequence.auto_enroll_website) throw new Error('Configure automatic enrollment with a Custom lead or website rule instead of built-in source flags.');
  const boolean = (group: Record<string, unknown>, field: string): boolean => group[field] === true;
  const text = (group: Record<string, unknown>, field: string): string => {
    const result = group[field];
    if (typeof result !== 'string') throw new Error('Choose valid task template wording.');
    return result;
  };
  const number = (group: Record<string, unknown>, field: string): number => {
    const result = group[field];
    if (typeof result !== 'number') throw new Error('Choose a valid automation number.');
    return result;
  };
  const priority = (group: Record<string, unknown>, field: string): 'low' | 'medium' | 'high' => {
    const result = group[field];
    if (result !== 'low' && result !== 'medium' && result !== 'high') throw new Error('Choose a valid task priority.');
    return result;
  };
  const statuses = follow.statuses;
  const milestones = renewal.milestones;
  if (!Array.isArray(statuses) || !Array.isArray(milestones)) throw new Error('Choose valid automation lists.');
  return {
    schema_version: 1,
    intake: { enabled: boolean(intake, 'enabled'), warm_priority: priority(intake, 'warm_priority'), cold_priority: priority(intake, 'cold_priority'),
      due_hour: number(intake, 'due_hour'), cold_next_business_day: boolean(intake, 'cold_next_business_day') },
    follow_up: { enabled: boolean(follow, 'enabled'), statuses: statuses.map((status: unknown) => {
      if (typeof status !== 'string') throw new Error('Choose valid stages.');
      return status;
    }), due_hour: number(follow, 'due_hour'), priority: priority(follow, 'priority') },
    reply: { enabled: boolean(reply, 'enabled'), due_minutes: number(reply, 'due_minutes'), complete_on_successful_send: boolean(reply, 'complete_on_successful_send') },
    renewal: { enabled: boolean(renewal, 'enabled'), window_days: number(renewal, 'window_days'), grace_days: number(renewal, 'grace_days'),
      milestones: milestones.map((milestone: unknown) => {
        if (typeof milestone !== 'number') throw new Error('Choose valid milestones.');
        return milestone;
      }), task_days_before: number(renewal, 'task_days_before'), urgent_days_before: number(renewal, 'urgent_days_before') },
    sequence: { total_steps: number(sequence, 'total_steps'), step_gap_days: number(sequence, 'step_gap_days'), auto_enroll_imports: false, auto_enroll_website: false },
    import_renewal: { tasks_enabled: boolean(importRenewal, 'tasks_enabled'), task_days_before: number(importRenewal, 'task_days_before') },
    reminders: { enabled: boolean(record(input.reminders), 'enabled') },
    notifications: {
      service_events: boolean(record(input.notifications), 'service_events'),
      renewals: boolean(record(input.notifications), 'renewals'),
      message_replies: boolean(record(input.notifications), 'message_replies'),
    },
    service: {
      tasks_enabled: boolean(service, 'tasks_enabled'), acknowledgment_email_enabled: boolean(service, 'acknowledgment_email_enabled'),
      task_templates: {
        claim: { subject: text(record(serviceTemplates.claim), 'subject'), description: text(record(serviceTemplates.claim), 'description') },
        endorsement: { subject: text(record(serviceTemplates.endorsement), 'subject'), description: text(record(serviceTemplates.endorsement), 'description') },
        certificate: { subject: text(record(serviceTemplates.certificate), 'subject'), description: text(record(serviceTemplates.certificate), 'description') },
      },
    },
  };
}

export const AUTOMATION_RULE_INVENTORY: ReadonlyArray<{
  id: BuiltInAutomationId;
  label: string;
  events: readonly string[];
  actions: readonly string[];
  runtime_configuration: 'saved_policy';
}> = [
  { id: 'intake', label: 'First contact', events: ['lead.created', 'website.submitted'], actions: ['task.create', 'notification.create'], runtime_configuration: 'saved_policy' },
  { id: 'follow_up', label: 'Pipeline follow-up', events: ['follow_up.due'], actions: ['task.create'], runtime_configuration: 'saved_policy' },
  { id: 'reply', label: 'Incoming replies', events: ['message.received', 'message.sent_successfully'], actions: ['task.reconcile', 'notification.create'], runtime_configuration: 'saved_policy' },
  { id: 'renewal', label: 'Renewal radar', events: ['policy.saved', 'renewal.due'], actions: ['task.reconcile', 'notification.create'], runtime_configuration: 'saved_policy' },
  { id: 'import_renewal', label: 'Imported renewal follow-ups', events: ['import.promoted'], actions: ['task.create'], runtime_configuration: 'saved_policy' },
  { id: 'sequence', label: 'Outreach sequences', events: ['sequence.enrolled', 'sequence.due'], actions: ['draft.create', 'email.send_if_authorized'], runtime_configuration: 'saved_policy' },
  { id: 'reminders', label: 'Due reminders', events: ['reminder.due'], actions: ['notification.create'], runtime_configuration: 'saved_policy' },
  { id: 'notifications', label: 'In-app notifications', events: ['service.created', 'renewal.due', 'message.received'], actions: ['notification.create'], runtime_configuration: 'saved_policy' },
  { id: 'service', label: 'Service requests', events: ['service.created', 'service.resolved'], actions: ['task.reconcile', 'email.send_if_authorized'], runtime_configuration: 'saved_policy' },
];

export const AUTOMATION_EXECUTION_POLICY = {
  scope: 'future_events',
  existing_work: 'explicit_preview_and_apply',
  approved_drafts: 'preserve_approved_snapshot',
  active_sequences: 'preserve_enrollment_snapshot',
  disabling: 'stop_future_execution_preserve_existing_work',
  idempotency: ['event', 'rule_revision', 'target'],
  uncertain_sends: 'no_automatic_retry',
  custom_rules: 'supported_events_and_guarded_actions',
  automated_sms: 'unavailable',
  automatic_enrollment: 'custom_source_rules_manual_approval',
} as const;
