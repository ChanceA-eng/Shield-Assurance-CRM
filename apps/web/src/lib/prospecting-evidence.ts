import type { BusinessObservation, BusinessResearchProfile } from '@crm/shared';
import { validEvidenceDate, readRenewalEvidence } from '@crm/shared';

export interface ProspectingEvidence {
  text: string;
  source: string;
  recordId: string;
  observedOn: string;
  fetchedAt: string;
}

const SOURCE_LABELS: Record<BusinessObservation['source'], string> = {
  fmcsa_census: 'FMCSA Census',
  osm: 'OpenStreetMap business listing',
  irs: 'IRS exempt organization filing',
  dol_5500: 'DOL Form 5500 filing',
};

function recentDate(value: string, now: Date, maxAgeDays: number): boolean {
  const parsed = Date.parse(value);
  const age = now.getTime() - parsed;
  return Number.isFinite(parsed) && age >= 0 && age <= maxAgeDays * 86400000;
}

function observationDate(observation: BusinessObservation): string | null {
  const reported = observation.values.registration_reported_on;
  if (validEvidenceDate(reported)) return reported;
  return validEvidenceDate(observation.source_as_of) ? observation.source_as_of : null;
}

export function prospectingEvidence(
  profile: BusinessResearchProfile | null | undefined,
  now = new Date(),
): ProspectingEvidence[] {
  const observations = profile?.business?.observations ?? [];
  if (profile?.job?.result?.insights.some((insight) => insight.kind === 'conflict')) return [];
  const results: ProspectingEvidence[] = [];
  for (const observation of observations) {
    const fetchedAt = observation.fetched_at;
    if (!recentDate(fetchedAt, now, 30)) continue;
    const observedOn = observationDate(observation);
    if (observedOn && !recentDate(`${observedOn}T00:00:00Z`, now, 90)) continue;
    if (!observedOn && observation.source !== 'osm') continue;

    const dateLabel = observedOn ? `reported ${observedOn}` : `retrieved ${fetchedAt.slice(0, 10)}`;
    if (observation.source === 'fmcsa_census' && typeof observation.values.power_units === 'number'
      && observation.values.power_units >= 0 && observedOn) {
      results.push({
        text: `A fleet record lists ${observation.values.power_units} power units (${dateLabel}).`,
        source: SOURCE_LABELS[observation.source], recordId: observation.record_id, observedOn, fetchedAt,
      });
    }

    const category = observation.values.industry?.trim();
    if (category && observation.values.classification !== 'unknown'
      && (observation.source === 'osm' || observation.values.classification === 'reported')) {
      results.push({
        text: `A recent business listing categorizes the company as ${category} (${dateLabel}).`,
        source: SOURCE_LABELS[observation.source], recordId: observation.record_id,
        observedOn: observedOn ?? fetchedAt.slice(0, 10), fetchedAt,
      });
    }
  }
  return [...new Map(results.map((item) => [`${item.source}:${item.recordId}:${item.text}`, item])).values()].slice(0, 5);
}

export function prospectingSignalText(evidence: ProspectingEvidence[]): string {
  return evidence[0]?.text ?? '';
}

export function prospectingReadiness(
  research: BusinessResearchProfile | null,
  renewals: unknown,
  now = new Date(),
) {
  const signals = prospectingEvidence(research, now);
  const confirmedRenewal = readRenewalEvidence(renewals).filter((renewal) =>
    renewal.evidence_class === 'confirmed' && renewal.precision === 'date'
      && Date.parse(`${renewal.date}T00:00:00Z`) >= now.getTime()
      && renewal.confirmed_on && recentDate(`${renewal.confirmed_on}T00:00:00Z`, now, 90))
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const fleet = signals.some((signal) => signal.source === 'FMCSA Census');
  const dataLevel = signals.length && confirmedRenewal ? 'full' : fleet ? 'size' : 'contact-only';
  const daysToRenewal = confirmedRenewal ? Math.ceil((Date.parse(`${confirmedRenewal.date}T00:00:00Z`) - now.getTime()) / 86400000) : null;
  const suggestedPriority = signals.length && daysToRenewal !== null && daysToRenewal <= 130 ? 'A' : signals.length ? 'B' : 'C';
  const reason = suggestedPriority === 'A' ? 'Fresh business facts and a confirmed renewal within 130 days.'
    : suggestedPriority === 'B' ? 'Fresh business facts; buying timing is not yet confirmed.'
      : 'Confirm the business details and timing before making specific claims.';
  const nurtureDate = confirmedRenewal
    ? new Date(Date.parse(`${confirmedRenewal.date}T00:00:00Z`) - 130 * 86400000).toISOString().slice(0, 10) : null;
  return {
    data_level: dataLevel,
    signals,
    suggested_priority: suggestedPriority,
    priority_reason: reason,
    confirmed_renewal: confirmedRenewal,
    nurture_on: nurtureDate && Date.parse(`${nurtureDate}T00:00:00Z`) > now.getTime() ? nurtureDate : null,
    identity: research?.business ? 'Linked business record; confirm this is the same business before using its details.' : 'No linked business evidence.',
    needs_confirmation: !signals.length || Boolean(research?.job?.result?.insights.some((insight) => insight.kind === 'conflict')),
  };
}
