export interface DossierFindings {
  business_identity: string;
  decision_maker: string;
  buying_process: string;
  stated_priorities: string;
  required_lines: string;
  renewal_line: string;
  renewal_date: string;
  next_step: string;
}

export const EMPTY_DOSSIER_FINDINGS: DossierFindings = {
  business_identity: '', decision_maker: '', buying_process: '', stated_priorities: '',
  required_lines: '', renewal_line: '', renewal_date: '', next_step: '',
};

export interface DossierConfirmation {
  id: string;
  scope_key: string;
  version: number;
  actor_id: string;
  observed_at: string;
  source_as_of: string;
  reference: string;
  findings: DossierFindings;
}

export interface DossierObservation {
  id: string;
  source: string;
  observed_at: string;
  source_as_of: string | null;
  match_method: string;
  snapshot: Record<string, unknown>;
  lead_id: string;
}

export interface IntelligenceDossier {
  scope_key: string;
  record_name: string;
  version: number;
  findings: DossierFindings;
  current_confirmation?: DossierConfirmation | null;
  confirmations: DossierConfirmation[];
  observations: DossierObservation[];
  observations_total: number;
  history_total: number;
  page: number;
}

export interface DossierSignal {
  title: string;
  detail: string;
  evidence_ids: string[];
  classification: 'reported_change' | 'needs_verification';
}

export interface DossierBriefing {
  opening: string;
  questions: string[];
  missing: string[];
  signals: DossierSignal[];
  evidence_ids: string[];
}
