import { describe, expect, it } from 'vitest';
import {
  canTransitionPolicyServiceRequest,
  isCalendarDate,
  isPolicyServiceRequestStatus,
  isPolicyServiceRequestType,
} from './policy-service-requests';

describe('policy service request lifecycle', () => {
  it('accepts only supported request types and current workflow statuses', () => {
    expect(isPolicyServiceRequestType('vehicle_addition')).toBe(true);
    expect(isPolicyServiceRequestType('bind_policy')).toBe(false);
    expect(isPolicyServiceRequestStatus('waiting_on_carrier')).toBe(true);
    expect(isPolicyServiceRequestStatus('processed')).toBe(false);
  });

  it('allows only deliberate forward, close, cancel and reopen transitions', () => {
    expect(canTransitionPolicyServiceRequest('draft', 'submitted')).toBe(true);
    expect(canTransitionPolicyServiceRequest('waiting_on_carrier', 'confirmed')).toBe(true);
    expect(canTransitionPolicyServiceRequest('confirmed', 'closed')).toBe(true);
    expect(canTransitionPolicyServiceRequest('closed', 'reopened')).toBe(true);
    expect(canTransitionPolicyServiceRequest('cancelled', 'submitted')).toBe(false);
    expect(canTransitionPolicyServiceRequest('closed', 'confirmed')).toBe(false);
  });

  it('rejects invalid effective and confirmation calendar dates', () => {
    expect(isCalendarDate('2026-11-05')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-2-05')).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});
