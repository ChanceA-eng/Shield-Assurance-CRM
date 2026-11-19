export interface OpportunitySettings {
  industries: string;
  states: string;
  lines: string;
  excluded_industries: string;
  revenue_min: number | null;
  revenue_max: number | null;
  renewal_days: number;
  agent_capacity: number;
  recurring_enabled: boolean;
  refresh_days: number;
  digest_hour: number;
}

export const DEFAULT_OPPORTUNITY_SETTINGS: OpportunitySettings = {
  industries: '', states: '', lines: '', excluded_industries: '',
  revenue_min: null, revenue_max: null, renewal_days: 90, agent_capacity: 10,
  recurring_enabled: false, refresh_days: 7, digest_hour: 8,
};

export const OPPORTUNITY_STAGES = [
  'discovered', 'contact_verified', 'qualified', 'meeting', 'submission', 'quote', 'bound', 'declined', 'lost',
] as const;
export type OpportunityStage = typeof OPPORTUNITY_STAGES[number];
export interface OpportunityOutcome {
  id: string;
  stage: OpportunityStage;
  occurred_on: string;
  reason: string;
  source: string;
  cost: number;
  premium: number | null;
  actor_id: string;
}
export interface OpportunityOperations {
  watch: { enabled: boolean; last_evaluated_at: string | null; next_due_at: string; error: string | null } | null;
  outcomes: OpportunityOutcome[];
  evidence: Array<{ id: string; kind: string; value: string; source_as_of: string; reference: string; previous_value: string | null; previous_as_of: string | null }>;
  relationships: Array<{ id: string; name: string; reference: string; state: 'suggested' | 'approved' | 'dismissed' }>;
  held_lines: string[];
  documents: Array<{ id: string; file_name: string; review_summary?: string }>;
  requests: Array<{ id: string; questions: string; state: 'requested' | 'responded' | 'answered'; response: string; source_as_of: string | null }>;
}
