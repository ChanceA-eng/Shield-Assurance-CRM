export const CRM_WORKFLOW_EVENTS = [
  'lead.created', 'lead.stage_changed', 'website.submitted', 'message.received', 'service.changed',
  'policy.changed', 'renewal.milestone', 'reminder.due', 'outreach.drafted', 'outreach.accepted', 'outreach.blocked',
] as const;
export const CRM_WORKFLOW_ACTIONS = ['create_task', 'notify', 'create_note', 'enroll_sequence', 'draft_sequence'] as const;
export type CrmWorkflowEvent = typeof CRM_WORKFLOW_EVENTS[number];
export type CrmWorkflowAction = typeof CRM_WORKFLOW_ACTIONS[number];
export interface CrmWorkflowDefinition {
  schema_version: 1;
  name: string;
  event: CrmWorkflowEvent;
  active: boolean;
  conditions: { sources: string[]; stages: string[]; statuses: string[]; lines: string[]; assignee: string | null };
  action: { type: CrmWorkflowAction; content: string; delay_minutes: number; priority: 'low' | 'medium' | 'high'; assignee: string | null };
}
export interface CrmWorkflowRule { id: string; revision: number; definition: CrmWorkflowDefinition; updated_at: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseWorkflowRule(value: unknown): CrmWorkflowRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved workflow rule could not be verified.');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.revision !== 'number' || !Number.isInteger(row.revision)
    || row.revision < 1 || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('The saved workflow identity or revision is invalid.');
  return { id: row.id, revision: row.revision, updated_at: row.updated_at, definition: validateWorkflowDefinition(row.definition) };
}
export function validateWorkflowDefinition(value: unknown): CrmWorkflowDefinition {
  const object = (input: unknown, keys: string[]): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a complete workflow rule.');
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) throw new Error('An unsupported workflow setting was supplied.');
    return record;
  };
  const rule = object(value, ['schema_version', 'name', 'event', 'active', 'conditions', 'action']);
  if (rule.schema_version !== 1 || typeof rule.active !== 'boolean') throw new Error('Choose a supported workflow version and activation state.');
  if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.trim().length > 100) throw new Error('Rule name must contain 1-100 characters.');
  const event = CRM_WORKFLOW_EVENTS.find((event) => event === rule.event);
  const conditions = object(rule.conditions, ['sources', 'stages', 'statuses', 'lines', 'assignee']);
  const action = object(rule.action, ['type', 'content', 'delay_minutes', 'priority', 'assignee']);
  const type = CRM_WORKFLOW_ACTIONS.find((type) => type === action.type);
  if (!event || !type) throw new Error('Choose a supported event and action.');
  if ((type === 'enroll_sequence' || type === 'draft_sequence') && !['lead.created', 'lead.stage_changed', 'website.submitted'].includes(event)) {
    throw new Error('Sequence actions require a lead or website intake event.');
  }
  const member = (value: unknown): string | null => {
    if (value === null) return null;
    if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Choose an actual agency member.');
    return value;
  };
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 100)) throw new Error('Choose at most 20 valid condition values.');
    const values = value.map((item: string) => item.trim().toLowerCase());
    if (new Set(values).size !== values.length) throw new Error('Condition values must not repeat.');
    return values;
  };
  const stages = list(conditions.stages);
  if (stages.some((stage) => !['new', 'contacted', 'quoted', 'negotiation', 'won', 'lost'].includes(stage))) throw new Error('Choose supported pipeline stages.');
  if (typeof action.content !== 'string' || action.content.length > (type === 'create_task' ? 240 : type === 'notify' ? 500 : 2000)) throw new Error('Action text is too long or invalid.');
  if (['create_task', 'notify', 'create_note'].includes(type) ? !action.content.trim() : action.content !== '') throw new Error('Provide action text only for tasks, notifications or notes.');
  if (typeof action.delay_minutes !== 'number' || !Number.isInteger(action.delay_minutes) || action.delay_minutes < 0 || action.delay_minutes > 10080
    || (type !== 'create_task' && action.delay_minutes !== 0)) throw new Error('Task delay must be 0-10080 whole minutes; other actions have no delay.');
  const priority = action.priority;
  if (priority !== 'low' && priority !== 'medium' && priority !== 'high') throw new Error('Choose a supported task priority.');
  const assignee = member(action.assignee);
  if (type !== 'create_task' && (assignee !== null || priority !== 'medium')) throw new Error('Assignment and priority apply only to task actions.');
  return { schema_version: 1, name: rule.name.trim(), event, active: rule.active,
    conditions: { sources: list(conditions.sources), stages, statuses: list(conditions.statuses), lines: list(conditions.lines), assignee: member(conditions.assignee) },
    action: { type, content: action.content.trim(), delay_minutes: action.delay_minutes, priority, assignee } };
}
