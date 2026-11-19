import { describe, expect, it } from 'vitest';
import { CRM_WORKFLOW_EVENTS, parseWorkflowRule, validateWorkflowDefinition, type CrmWorkflowDefinition } from '@crm/shared';

const member = 'e9c01a31-1e57-4a26-b3d4-65e5a7b1f88a';
export const workflowDefinition: CrmWorkflowDefinition = {
  schema_version: 1, name: 'Review incoming lead', event: 'lead.created', active: false,
  conditions: { sources: [], stages: [], statuses: [], lines: [], assignee: null },
  action: { type: 'create_task', content: 'Review {{name}}', delay_minutes: 30, priority: 'high', assignee: member },
};
describe('strict custom workflow contract', () => {
  it.each(CRM_WORKFLOW_EVENTS)('accepts supported event %s for internal work', (event) => {
    expect(validateWorkflowDefinition({ ...workflowDefinition, event }).event).toBe(event);
  });
  it('normalizes condition values without permitting duplicates or invented member identities', () => {
    expect(validateWorkflowDefinition({ ...workflowDefinition, conditions: {
      ...workflowDefinition.conditions, sources: [' Website-Pull '], statuses: [' OPEN '],
    } }).conditions).toMatchObject({ sources: ['website-pull'], statuses: ['open'] });
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, conditions: {
      ...workflowDefinition.conditions, sources: ['website', ' Website '],
    } })).toThrow('repeat');
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, action: { ...workflowDefinition.action, assignee: 'Owner' } })).toThrow('actual');
  });
  it.each([
    { ...workflowDefinition, script: 'unsupported' },
    { ...workflowDefinition, schema_version: 2 },
    { ...workflowDefinition, name: ' ' },
    { ...workflowDefinition, name: 'x'.repeat(101) },
    { ...workflowDefinition, event: 'deal.bound' },
    { ...workflowDefinition, conditions: { ...workflowDefinition.conditions, stages: ['invented'] } },
    { ...workflowDefinition, conditions: { ...workflowDefinition.conditions, sources: Array.from({ length: 21 }, (_, i) => `source-${i}`) } },
    { ...workflowDefinition, action: { ...workflowDefinition.action, type: 'send_email' } },
    { ...workflowDefinition, action: { ...workflowDefinition.action, delay_minutes: null } },
    { ...workflowDefinition, action: { ...workflowDefinition.action, delay_minutes: 10081 } },
    { ...workflowDefinition, action: { ...workflowDefinition.action, delay_minutes: 0.5 } },
    { ...workflowDefinition, action: { ...workflowDefinition.action, content: 'x'.repeat(241) } },
  ])('rejects malformed, unsafe or out-of-bounds definitions %#', (definition) => {
    expect(() => validateWorkflowDefinition(definition)).toThrow();
  });
  it.each(['enroll_sequence', 'draft_sequence'] as const)('restricts %s to source events and excludes send/task parameters', (type) => {
    const action = { type, content: '', delay_minutes: 0, priority: 'medium', assignee: null };
    expect(validateWorkflowDefinition({ ...workflowDefinition, action }).action.type).toBe(type);
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, event: 'message.received', action })).toThrow('require');
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, action: { ...action, content: 'Send now' } })).toThrow('text');
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, action: { ...action, assignee: member } })).toThrow('only');
  });
  it.each([['create_task', 240], ['notify', 500], ['create_note', 2000]] as const)('tests exact text limits for %s', (type, max) => {
    const action = { type, content: 'x'.repeat(max), delay_minutes: 0, priority: 'medium', assignee: null };
    expect(validateWorkflowDefinition({ ...workflowDefinition, action }).action.content).toHaveLength(max);
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, action: { ...action, content: 'x'.repeat(max + 1) } })).toThrow();
    expect(() => validateWorkflowDefinition({ ...workflowDefinition, action: { ...action, content: ' ' } })).toThrow();
  });
  it('verifies actual persisted identities, dates and revisions rather than accepting success-shaped rows', () => {
    const row = { id: member, revision: 1, definition: workflowDefinition, updated_at: '2026-11-05T15:00:00Z' };
    expect(parseWorkflowRule(row)).toEqual(row);
    for (const value of [null, { ...row, id: 'fake' }, { ...row, revision: 0 }, { ...row, updated_at: 'invalid' }]) {
      expect(() => parseWorkflowRule(value)).toThrow();
    }
  });
});
