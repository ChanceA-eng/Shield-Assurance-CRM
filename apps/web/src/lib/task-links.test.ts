import { describe, expect, it } from 'vitest';
import { businessIntelligenceHref, taskRecordHref } from './task-links';

describe('task record links', () => {
  it('opens business intelligence within the existing lead or account overview', () => {
    expect(businessIntelligenceHref({ type: 'lead', id: 'lead1' })).toBe('/leads?lead=lead1&tab=overview&intelligence=1');
    expect(businessIntelligenceHref({ type: 'client', id: 'account1' })).toBe('/clients/account1?tab=overview&intelligence=1');
  });
  it('opens canonical records and legacy policy/service context', () => {
    expect(taskRecordHref({ related_type: 'lead', related_id: 'lead1' })).toBe('/leads?lead=lead1');
    expect(taskRecordHref({ related_type: 'client', related_id: 'account1' })).toBe('/clients/account1?tab=tasks');
    expect(taskRecordHref({ related_type: 'policy', related_id: 'policy1', account_id: 'account1' })).toBe('/clients/account1?tab=policies&context_type=policy&context_id=policy1');
    expect(taskRecordHref({ related_type: 'claim', related_id: 'claim1', account_id: 'account1' })).toBe('/clients/account1?tab=policies&context_type=claim&context_id=claim1');
    expect(taskRecordHref({ related_type: 'policy_change_request', related_id: 'request1', account_id: 'account1' })).toBe('/clients/account1?tab=policies&service_request=request1');
    expect(taskRecordHref({ related_type: 'event', related_id: 'event1' })).toBe('/scheduler?event=event1');
    expect(taskRecordHref({})).toBeNull();
  });
  it('opens the actual automated action while rejecting external action URLs', () => {
    expect(taskRecordHref({ related_type: 'lead', related_id: 'lead1', action_href: '/outreach?attempt=attempt1' })).toBe('/outreach?attempt=attempt1');
    expect(taskRecordHref({ action_href: '/communication?conversation=unmatched%3Atest' })).toBe('/communication?conversation=unmatched%3Atest');
    expect(taskRecordHref({ action_href: '//untrusted.example' })).toBeNull();
    expect(taskRecordHref({ action_href: 'https://untrusted.example' })).toBeNull();
  });
});
