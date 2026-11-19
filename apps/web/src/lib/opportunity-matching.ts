import { BUSINESS_FIELDS, NUMERIC_BUSINESS_FIELDS, validEvidenceDate, appetiteCoverage, appetiteScopesOverlap,
  type AppetitePredicate, type BusinessField, type CarrierAppetiteDocument, type CarrierAppetiteRule,
  type IntelligenceDossier, type OpportunityAssessment, type OpportunityMarket, type OpportunityProfile } from '@crm/shared';
import { dossierBriefing, confirmedDossierRenewal } from './dossier';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';

const numeric = (field: BusinessField): boolean => NUMERIC_BUSINESS_FIELDS.some((key) => key === field);
const normalized = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');
const parts = (text: string): string[] => text.split(/[,;\n]/).map(normalized).filter(Boolean);
export function parseAppetitePredicate(value: unknown): AppetitePredicate {
  if (!isRecord(value) || !BUSINESS_FIELDS.some((field) => field === value.field)
    || !['is', 'in', 'gte', 'lte'].includes(String(value.operator))
    || typeof value.value !== 'string' || !value.value.trim() || value.value.length > 500) {
    throw new WorkspaceError('Choose a business field, comparison and documented comparison value.', 400);
  }
  const field = value.field as BusinessField, operator = value.operator as AppetitePredicate['operator'];
  if (numeric(field)) {
    if (!['is', 'gte', 'lte'].includes(operator) || !/^\d+(?:\.\d+)?$/.test(value.value.trim()) || !Number.isFinite(Number(value.value))) {
      throw new WorkspaceError('Numeric carrier criteria need a nonnegative number and is / minimum / maximum comparison.', 400);
    }
  } else if (!['is', 'in'].includes(operator)) throw new WorkspaceError('Text and yes/no criteria use is or in comparisons.', 400);
  if (['has_delivery', 'has_prior_losses'].includes(field) && !parts(value.value).every((item) => ['yes', 'no'].includes(item))) {
    throw new WorkspaceError('Use yes or no for business activity criteria.', 400);
  }
  return { field, operator, value: value.value.trim() };
}
export function parseOpportunityProfile(value: unknown, today = new Date().toISOString().slice(0, 10)): OpportunityProfile {
  if (!isRecord(value) || !isRecord(value.facts) || typeof value.source_reference !== 'string'
    || !value.source_reference.trim() || value.source_reference.length > 1000
    || !validEvidenceDate(value.confirmed_on) || value.confirmed_on > today
    || !['unknown', 'permitted', 'do_not_contact'].includes(String(value.permission))
    || !['unknown', 'verified_email', 'verified_phone'].includes(String(value.contactability))
    || !['unknown', 'new', 'referred', 'existing_client'].includes(String(value.relationship))) {
    throw new WorkspaceError('Record reviewed business facts, a source, confirmation date and contact permission status.', 400);
  }
  const facts: OpportunityProfile['facts'] = {};
  for (const [field, entry] of Object.entries(value.facts)) {
    if (!BUSINESS_FIELDS.some((key) => key === field) || typeof entry !== 'string' || entry.length > 200) {
      throw new WorkspaceError('Only the listed business facts can be used for market matching.', 400);
    }
    const key = field as BusinessField;
    if (!entry.trim()) continue;
    if (numeric(key) && (!/^\d+(?:\.\d+)?$/.test(entry.trim()) || !Number.isFinite(Number(entry)))) throw new WorkspaceError('Enter numeric business facts without currency symbols or separators.', 400);
    if (['has_delivery', 'has_prior_losses'].includes(key) && !['yes', 'no'].includes(entry.trim())) throw new WorkspaceError('Choose yes, no or leave the activity unknown.', 400);
    facts[key] = entry.trim();
  }
  return { facts, source_reference: value.source_reference.trim(), confirmed_on: value.confirmed_on,
    permission: value.permission as OpportunityProfile['permission'], contactability: value.contactability as OpportunityProfile['contactability'],
    relationship: value.relationship as OpportunityProfile['relationship'] };
}
function compare(rule: CarrierAppetiteRule, profile: OpportunityProfile, fresh: boolean): 'matched' | 'not_matched' | 'unknown' {
  if (!rule.predicate || !fresh) return 'unknown';
  const predicate = parseAppetitePredicate(rule.predicate);
  const fact = profile.facts[predicate.field];
  if (!fact) return 'unknown';
  const matches = numeric(predicate.field)
    ? predicate.operator === 'gte' ? Number(fact) >= Number(predicate.value)
      : predicate.operator === 'lte' ? Number(fact) <= Number(predicate.value) : Number(fact) === Number(predicate.value)
    : predicate.operator === 'in' ? parts(predicate.value).includes(normalized(fact)) : normalized(predicate.value) === normalized(fact);
  return matches ? 'matched' : 'not_matched';
}
export function evaluateOpportunity(profile: OpportunityProfile, documents: CarrierAppetiteDocument[], dossier: IntelligenceDossier,
  today = new Date().toISOString().slice(0, 10), currentSourceFields: BusinessField[] = []): OpportunityAssessment {
  const age = (day: string): number => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day.slice(0, 10)}T00:00:00Z`)) / 86400000;
  const fresh = validEvidenceDate(profile.confirmed_on) && age(profile.confirmed_on) >= 0 && age(profile.confirmed_on) <= 90;
  const desired = appetiteCoverage(profile.facts.line ?? '');
  const active = documents.filter((document) => document.state === 'active'
    && (!desired.length || !appetiteCoverage(document.values.line).length
      || appetiteCoverage(document.values.line).some((line) => desired.includes(line))));
  const markets: OpportunityMarket[] = active.map((document) => {
    const values = document.values, reasons: string[] = [];
    if (values.unresolved_entries?.length) reasons.push('Some guide entries could not be read reliably. A carrier fit is not confirmed.');
    let excluded = false;
    if (!document.approved_by || !document.approved_at || !Number.isFinite(age(document.approved_at)) || age(document.approved_at) < 0) reasons.push('Carrier guide has not been enabled.');
    if (values.effective_on && (!validEvidenceDate(values.effective_on) || values.effective_on > today)) reasons.push('The guide is not yet in effect.');
    if (values.expires_on && (!validEvidenceDate(values.expires_on) || values.expires_on < today)) reasons.push('The carrier guide has expired.');
    if (active.some((other) => other.id !== document.id && appetiteScopesOverlap(values, other.values))) reasons.push('Other guides cover this same coverage and territory. Check their differences.');
    if (values.access === 'unconfirmed') reasons.push('Choose whether your agency uses this carrier directly or through a wholesaler.');
    if (values.access === 'unavailable') { excluded = true; reasons.push('The agency has no available placement route.'); }
    if (!fresh) reasons.push(currentSourceFields.length ? 'Based on public business details. Confirm them before submitting.'
      : 'Confirm current business details to narrow this recommendation.');
    for (const [field, allowed, label] of [['state', values.states, 'Territory'], ['line', values.line, 'Coverage line']] as const) {
      const fact = profile.facts[field];
      if (field === 'line' && !fact && allowed) continue;
      if (!fact || !allowed) reasons.push(field === 'state' ? 'Confirm the business state and where the carrier writes this coverage.' : 'Read the guide to identify its coverage.');
      else if (!(field === 'line' ? appetiteCoverage(allowed).some((line) => appetiteCoverage(fact).includes(line))
        : parts(allowed).includes('all') || parts(allowed).includes(normalized(fact)))) {
        reasons.push(`${label} does not exactly match documented scope. Confirm terminology; no fuzzy match was assumed.`);
      }
    }
    const rules = values.rules.map((rule) => {
      const sourceCurrent = !!rule.predicate && currentSourceFields.includes(rule.predicate.field);
      const result = compare(rule, profile, fresh || sourceCurrent);
      return { id: rule.id, criterion: rule.criterion, excerpt: rule.excerpt, page: rule.page, decision: rule.decision, result,
        reason: !rule.predicate ? `Confirm with the carrier: ${rule.criterion}`
          : !fresh && !sourceCurrent ? 'Business facts need reconfirmation.'
            : !profile.facts[rule.predicate.field] ? `Missing business fact: ${rule.predicate.field.replace(/_/g, ' ')}.`
              : `${sourceCurrent && !fresh ? 'Reported source fact: ' : ''}${rule.predicate.field.replace(/_/g, ' ')} ${rule.predicate.operator} ${rule.predicate.value}: ${result.replace(/_/g, ' ')}.` };
    });
    const currentGuidance = !!document.approved_by && !!document.approved_at && Number.isFinite(age(document.approved_at)) && age(document.approved_at) >= 0
      && (!values.effective_on || validEvidenceDate(values.effective_on) && values.effective_on <= today)
      && (!values.expires_on || validEvidenceDate(values.expires_on) && values.expires_on >= today);
    let positive = false;
    for (const rule of rules) {
      if (rule.decision === 'needs_review'
        || rule.result === 'unknown' && !['preferred', 'eligible'].includes(rule.decision)) reasons.push(rule.reason);
      if (rule.decision === 'excluded' && rule.result === 'matched') {
        if (currentGuidance) excluded = true;
        reasons.push(`Documented exclusion: ${rule.criterion}`);
      }
      if (rule.decision === 'condition' && rule.result === 'not_matched') {
        if (currentGuidance) excluded = true;
        reasons.push(`Required condition not met: ${rule.criterion}`);
      }
      if (rule.decision === 'referral' && rule.result === 'matched') reasons.push(`Carrier referral required: ${rule.criterion}`);
      if (['preferred', 'eligible'].includes(rule.decision) && rule.result === 'matched') positive = true;
    }
    if (!positive) reasons.push('Confirm the business activity or fleet details against the guide’s target classes.');
    const coverage = values.line || 'Coverage not identified';
    const matches = rules.filter((rule) => rule.result === 'matched' && ['preferred', 'eligible'].includes(rule.decision));
    const restriction = reasons.find((reason) => /^(?:Documented exclusion:|Required condition not met:|The agency has no available placement route)/.test(reason));
    const recommendation = excluded ? `Do not shortlist for ${coverage}. ${restriction ?? 'A documented restriction applies.'}`
      : positive ? `${reasons.length ? 'Worth reviewing' : 'Shortlist'} for ${coverage}: ${matches.map((rule) => rule.criterion).slice(0, 2).join('; ')}.${reasons.length ? ' Confirm the items below before submitting.' : ' Confirm final terms with the carrier.'}`
        : `More information needed for ${coverage}. ${values.interpretation ? 'Compare this business with the target classes below.' : 'Read this guide with AI once to build reusable matching criteria.'}`;
    return { document_id: document.id, revision: document.revision, carrier: values.carrier, title: values.title,
      coverage, summary: values.interpretation?.summary, recommendation,
      status: excluded ? 'excluded' : reasons.length ? 'needs_review' : 'possible_fit', reasons: [...new Set(reasons)], rules };
  });
  const status = markets.some((market) => market.status === 'possible_fit') ? 'possible_fit'
    : markets.length && markets.every((market) => market.status === 'excluded') ? 'excluded' : 'needs_review';
  const renewal = confirmedDossierRenewal(dossier);
  const days = renewal ? -age(renewal.date) : null;
  const dossierDate = dossier.current_confirmation?.source_as_of;
  const dossierFresh = !!dossierDate && age(dossierDate) >= 0 && age(dossierDate) <= 90;
  const timing = dossierFresh && days !== null && days >= 0 && days <= 90 ? days <= 30 ? 25 : days <= 60 ? 18 : 10 : 0;
  const fit = status === 'possible_fit' ? 40 : status === 'needs_review' ? 10 : 0;
  const evidence = fresh ? dossierFresh ? 20 : 10 : 0;
  const contactability = fresh && profile.permission === 'permitted' && profile.contactability !== 'unknown' ? 10 : 0;
  const relationship = fresh ? profile.relationship === 'existing_client' ? 5 : profile.relationship === 'referred' ? 3 : 0 : 0;
  const missing = [...new Set(markets.flatMap((market) => market.reasons))];
  if (!markets.length) missing.push('No active reviewed carrier guidance is available.');
  if (profile.permission !== 'permitted' || !fresh) missing.push('Current permission to contact must be confirmed; matching never establishes consent.');
  const briefing = dossierBriefing(dossier, new Date(`${today}T12:00:00Z`));
  briefing.missing = [...new Set([...briefing.missing.filter((item) => item !== 'Current agency appetite and appointment/access verification'), ...missing])];
  return { status, markets, missing, briefing,
    score: { fit, timing, evidence, contactability, relationship, total: fit + timing + evidence + contactability + relationship,
      explanations: [`Fit ${fit}/40: ${status.replace(/_/g, ' ')}; not a placement probability.`,
        `Timing ${timing}/25: ${timing ? `${days} days to a recently confirmed renewal` : 'No current confirmed renewal within 90 days'}.`,
        `Evidence ${evidence}/20: business facts ${fresh ? 'current' : 'need review'}, dossier ${dossierFresh ? 'current' : 'needs review'}.`,
        `Contactability ${contactability}/10: verified route and current contact permission required.`,
        `Relationship ${relationship}/5: reviewed relationship only.`] },
    next_step: profile.permission === 'do_not_contact' ? 'Do not contact. Review internal market evidence only.'
      : status === 'excluded' ? 'Resolve the documented exclusion or unavailable route; do not recommend this market.'
        : status === 'needs_review' ? 'Review the coverage recommendations below and confirm the missing business details.'
          : 'Ask permission for a needs review; confirm underwriting details with the carrier before any placement recommendation.' };
}
