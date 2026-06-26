export type DealStage = 'LEAD' | 'QUOTING' | 'PRESENTED' | 'BOUND' | 'LOST';

export const WORKFLOW_EVENTS = {
  DEAL_BOUND: 'deal.bound',
} as const;

export type WorkflowEventName = (typeof WORKFLOW_EVENTS)[keyof typeof WORKFLOW_EVENTS];

export interface DealBoundEventPayload {
  dealId: string;
  accountId: string;
  triggeredBy: string;
  occurredAt: string;
}
