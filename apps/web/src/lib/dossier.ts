import { EMPTY_DOSSIER_FINDINGS, validEvidenceDate, readRenewalEvidence, renewalEvidenceLabel,
  type DossierFindings, type DossierBriefing, type DossierSignal, type IntelligenceDossier, type RecordTarget } from '@crm/shared';
import { WorkspaceError } from './record-scope';
import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';

export interface DossierDraftFact {
  field: keyof DossierFindings;
  label: string;
  value: string;
  source_as_of: string;
}

const draftableFindings: Array<[keyof DossierFindings, string]> = [
  ['business_identity', 'Confirmed business / branch identity'],
  ['buying_process', 'Confirmed buying process'],
  ['stated_priorities', 'Prospect-stated priorities'],
  ['required_lines', 'Required coverage lines'],
  ['renewal_line', 'Confirmed renewal line'],
  ['renewal_date', 'Confirmed renewal date'],
  ['next_step', 'Agreed next step'],
];

export function currentDossierDraftFacts(value: unknown): DossierDraftFact[] {
  if (!isRecord(value) || typeof value.scope_key !== 'string' || typeof value.version !== 'number'
    || !Number.isInteger(value.version) || !isRecord(value.findings)) {
    throw new WorkspaceError('Confirmed dossier findings could not be verified.', 503);
  }
  if (value.version === 0 && value.current_confirmation == null) return [];
  const confirmation = value.current_confirmation;
  if (!isRecord(confirmation) || confirmation.scope_key !== value.scope_key || confirmation.version !== value.version
    || !validEvidenceDate(confirmation.source_as_of) || typeof confirmation.reference !== 'string'
    || !confirmation.reference.trim() || !isRecord(confirmation.findings)) {
    throw new WorkspaceError('Current dossier confirmation could not be verified. Reload the dossier before drafting.', 503);
  }

  const facts: DossierDraftFact[] = [];
  for (const [field, label] of draftableFindings) {
    const activeValue = value.findings[field] ?? '';
    const confirmedValue = confirmation.findings[field] ?? '';
    if (typeof activeValue !== 'string' || typeof confirmedValue !== 'string'
      || activeValue !== confirmedValue || activeValue.length > 1000) {
      throw new WorkspaceError('Current dossier findings do not match their confirmation. Reload the dossier before drafting.', 503);
    }
    if (activeValue.trim()) facts.push({ field, label, value: activeValue.trim(), source_as_of: confirmation.source_as_of });
  }
  return facts;
}

export function confirmedDossierRenewal(value: unknown): { line: string; date: string } | null {
  const facts = currentDossierDraftFacts(value);
  const line = facts.find((fact) => fact.field === 'renewal_line')?.value;
  const date = facts.find((fact) => fact.field === 'renewal_date')?.value;
  return line && validEvidenceDate(date) ? { line, date } : null;
}

export async function loadCurrentDossierDraftFacts(
  supabase: SupabaseClient,
  actorId: string,
  target: RecordTarget,
): Promise<DossierDraftFact[]> {
  const result = await supabase.rpc('get_intelligence_dossier', {
    p_actor: actorId,
    p_type: target.type,
    p_id: target.id,
    p_page: 0,
  });
  if (result.error) throw databaseError(result.error);
  return currentDossierDraftFacts(result.data);
}

export function parseDossierFindings(value: unknown): DossierFindings {
  if (!isRecord(value)) throw new WorkspaceError('Provide dossier findings.', 400);
  const findings = { ...EMPTY_DOSSIER_FINDINGS };
  for (const field of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(findings, field)) throw new WorkspaceError('An unsupported dossier field was supplied.', 400);
  }
  for (const field of Object.keys(findings) as Array<keyof DossierFindings>) {
    const text = value[field] ?? '';
    if (typeof text !== 'string' || text.length > 1000) throw new WorkspaceError('Findings must be text of up to 1000 characters.', 400);
    findings[field] = text.trim();
  }
  if (findings.renewal_date && (!validEvidenceDate(findings.renewal_date) || !findings.renewal_line)) {
    throw new WorkspaceError('Provide a valid confirmed renewal date and coverage line.', 400);
  }
  return findings;
}

/** Internal planning only: observations never establish coverage or market eligibility. */
export function dossierBriefing(dossier: IntelligenceDossier, now = new Date()): DossierBriefing {
  const signals: DossierSignal[] = [];
  const observations = dossier.observations;
  const confirmedRenewal = confirmedDossierRenewal(dossier);
  const fleets = observations.filter((observation) => observation.source === 'fmcsa'
    && typeof observation.snapshot.dot_number === 'string' && /^\d+$/.test(observation.snapshot.dot_number)
    && typeof observation.snapshot.power_units === 'number' && Number.isInteger(observation.snapshot.power_units)
    && observation.snapshot.power_units >= 0);
  const newest = fleets[0];
  if (newest) {
    const older = fleets.find((observation) => observation.id !== newest.id
      && observation.lead_id === newest.lead_id
      && observation.snapshot.dot_number === newest.snapshot.dot_number
      && validEvidenceDate(observation.snapshot.mcs150_date) && validEvidenceDate(newest.snapshot.mcs150_date)
      && observation.snapshot.mcs150_date < newest.snapshot.mcs150_date);
    if (older && older.snapshot.power_units !== newest.snapshot.power_units
      && Date.parse(newest.observed_at) <= now.getTime()
      && Date.parse(newest.observed_at) >= now.getTime() - 90 * 86400000
      && Date.parse(String(newest.snapshot.mcs150_date)) >= now.getTime() - 365 * 86400000
      && Date.parse(String(newest.snapshot.mcs150_date)) <= now.getTime()) {
      signals.push({
        title: 'Reported fleet count changed',
        detail: `FMCSA reported ${older.snapshot.power_units} to ${newest.snapshot.power_units} power units for DOT ${String(newest.snapshot.dot_number)}. Different reporting dates; verify identity and whether this is growth, a correction or reporting lag.`,
        evidence_ids: [older.id, newest.id], classification: 'needs_verification',
      });
    }
  }
  for (const observation of observations) {
    const capturedAt = Date.parse(observation.observed_at);
    if (!Number.isFinite(capturedAt) || capturedAt > now.getTime()
      || capturedAt < now.getTime() - 180 * 86400000) continue;
    for (const renewal of readRenewalEvidence(observation.snapshot.renewals)) {
      const sameLine = confirmedRenewal
        && renewal.type.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
          === confirmedRenewal.line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const conflictingTiming = confirmedRenewal && (renewal.precision === 'month'
        ? renewal.date.slice(0, 7) !== confirmedRenewal.date.slice(0, 7)
        : renewal.date !== confirmedRenewal.date);
      if (sameLine && conflictingTiming
        && renewal.evidence_class !== 'confirmed') {
        const detail = `The current agent-confirmed ${confirmedRenewal.line} renewal is ${confirmedRenewal.date}. A conflicting ${renewalEvidenceLabel(renewal).toLowerCase()} was suppressed; verify the current timing with the prospect.`;
        const existing = signals.find((signal) => signal.detail === detail);
        if (existing) {
          if (!existing.evidence_ids.includes(observation.id)) existing.evidence_ids.push(observation.id);
        } else {
          signals.push({
            title: 'Conflicting reported renewal timing',
            detail,
            evidence_ids: [observation.id],
            classification: 'needs_verification',
          });
        }
        continue;
      }
      const date = Date.parse(`${renewal.date}T12:00:00Z`);
      const monthEnd = Date.UTC(Number(renewal.date.slice(0, 4)), Number(renewal.date.slice(5, 7)), 1);
      if (renewal.evidence_class === 'unknown' || (renewal.precision === 'month' ? monthEnd : date + 86400000) < now.getTime()
        || date > now.getTime() + 90 * 86400000) continue;
      const detail = `${renewal.type}: ${renewalEvidenceLabel(renewal)}. Source reporting freshness is not established; confirm timing with the prospect.`;
      if (signals.some((signal) => signal.detail === detail)) continue;
      signals.push({ title: 'Reported renewal window', detail, evidence_ids: [observation.id], classification: 'needs_verification' });
    }
  }
  const findings = { ...EMPTY_DOSSIER_FINDINGS, ...dossier.findings };
  const missing: string[] = [];
  if (!findings.business_identity) missing.push('Business / branch identity');
  if (!findings.decision_maker) missing.push('Decision-maker role and buying authority');
  if (!findings.renewal_date) missing.push('Confirmed renewal line and timing');
  if (!findings.stated_priorities) missing.push('Prospect-stated priorities');
  if (!findings.buying_process) missing.push('Buying process');
  missing.push('Current agency appetite and appointment/access verification');
  const questions = [
    !findings.decision_maker ? 'Who is responsible for insurance decisions, and who else participates?' : 'Has the buying authority or decision team changed?',
    !findings.renewal_date ? 'Which coverage line is being reviewed, and what is its confirmed renewal date?' : 'Is the recorded renewal timing still current?',
    !findings.stated_priorities ? 'What matters most in this review: service, terms, requirements or another priority?' : 'Are the recorded priorities still accurate?',
    'What documents are you comfortable sharing for a review?',
  ];
  return {
    opening: 'Ask permission to review the business insurance needs and confirm the decision-maker and timing. Do not present unverified observations as coverage gaps, savings or a market promise.',
    questions, missing, signals, evidence_ids: [...new Set(signals.flatMap((signal) => signal.evidence_ids))],
  };
}
