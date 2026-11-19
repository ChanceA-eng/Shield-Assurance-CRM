import type { RecordTarget } from './account-workspace.js';
import type { DossierBriefing } from './dossier.js';

export const BUSINESS_FIELDS = ['state', 'line', 'class_code', 'industry', 'years_in_business', 'annual_revenue', 'power_units', 'operating_radius_miles', 'has_delivery', 'has_prior_losses', 'experience_mod', 'annual_payroll'] as const;
export type BusinessField = typeof BUSINESS_FIELDS[number];
export const NUMERIC_BUSINESS_FIELDS = ['years_in_business', 'annual_revenue', 'power_units', 'operating_radius_miles', 'experience_mod', 'annual_payroll'] as const;
export interface AppetitePredicate {
  field: BusinessField;
  operator: 'is' | 'in' | 'gte' | 'lte';
  value: string;
}
export interface OpportunityProfile {
  facts: Partial<Record<BusinessField, string>>;
  source_reference: string;
  confirmed_on: string;
  permission: 'unknown' | 'permitted' | 'do_not_contact';
  contactability: 'unknown' | 'verified_email' | 'verified_phone';
  relationship: 'unknown' | 'new' | 'referred' | 'existing_client';
}
export const EMPTY_OPPORTUNITY_PROFILE: OpportunityProfile = {
  facts: {}, source_reference: '', confirmed_on: '', permission: 'unknown', contactability: 'unknown', relationship: 'unknown',
};
export interface OpportunityProfileRecord {
  scope_key: string;
  revision: number;
  profile: OpportunityProfile;
}
export interface OpportunityRuleResult {
  id: string;
  page: number;
  excerpt: string;
  criterion: string;
  decision: string;
  result: 'matched' | 'not_matched' | 'unknown';
  reason: string;
}
export interface OpportunityMarket {
  document_id: string;
  revision: number;
  carrier: string;
  title: string;
  coverage?: string;
  summary?: string;
  recommendation?: string;
  status: 'possible_fit' | 'needs_review' | 'excluded';
  reasons: string[];
  rules: OpportunityRuleResult[];
}
export interface OpportunityScore {
  fit: number;
  timing: number;
  evidence: number;
  contactability: number;
  relationship: number;
  total: number;
  explanations: string[];
}
export interface OpportunityAssessment {
  status: 'possible_fit' | 'needs_review' | 'excluded';
  markets: OpportunityMarket[];
  score: OpportunityScore;
  next_step: string;
  missing: string[];
  briefing: DossierBriefing;
}
export interface OpportunityWorkspace {
  target: RecordTarget;
  record_name: string;
  profile: OpportunityProfileRecord;
  assessment: OpportunityAssessment;
  evidence_token: string;
  evaluated_on: string;
  target_status?: 'targeted' | 'unknown' | 'outside_target';
}
export interface OpportunityDraft {
  id: string;
  scope_key: string;
  revision: number;
  state: 'draft' | 'approved' | 'dispatching' | 'sent' | 'uncertain';
  subject: string;
  body: string;
  request_id: string;
  evidence_token: string;
}
