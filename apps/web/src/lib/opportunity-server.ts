import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_OPPORTUNITY_PROFILE, type CarrierAppetiteDocument, type IntelligenceDossier,
  type OpportunityProfileRecord, type OpportunityWorkspace, type RecordTarget, type OpportunityOperations, type OpportunitySettings } from '@crm/shared';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { evaluateOpportunity, parseOpportunityProfile } from './opportunity-matching';
import { parseCarrierAppetite } from './carrier-appetite';
import { isRecord } from './workspace-validation';
import { opportunityTarget, parseOpportunitySettings } from './opportunity-operations';
import { confirmedDossierRenewal } from './dossier';
export interface OpportunityContext {
  dossier: IntelligenceDossier;
  profile: OpportunityProfileRecord;
  carriers: CarrierAppetiteDocument[];
  evidence_token: string;
  evaluated_on: string;
  recipient: string | null;
  operations?: Omit<OpportunityOperations, 'watch' | 'outcomes'>;
  settings?: OpportunitySettings;
}
function isOpportunityContext(value: unknown): value is OpportunityContext {
  if (!isRecord(value) || !isRecord(value.dossier) || typeof value.dossier.scope_key !== 'string'
    || typeof value.dossier.record_name !== 'string' || !Number.isSafeInteger(value.dossier.version)
    || !isRecord(value.dossier.findings) || !Array.isArray(value.dossier.observations) || !Array.isArray(value.dossier.confirmations)
    || !isRecord(value.profile) || !Number.isSafeInteger(value.profile.revision)
    || typeof value.profile.scope_key !== 'string' || !Array.isArray(value.carriers)
    || typeof value.evidence_token !== 'string' || typeof value.evaluated_on !== 'string'
    || (value.recipient !== null && typeof value.recipient !== 'string')) return false;
  if (value.operations !== undefined) {
    const operations = value.operations;
    if (!isRecord(operations) || !Array.isArray(operations.evidence) || !operations.evidence.every((item: unknown) =>
      isRecord(item) && typeof item.id === 'string' && typeof item.kind === 'string' && typeof item.value === 'string'
        && typeof item.reference === 'string' && typeof item.source_as_of === 'string'
        && (item.previous_value == null || typeof item.previous_value === 'string')
        && (item.previous_as_of == null || typeof item.previous_as_of === 'string'))
      || !Array.isArray(operations.held_lines) || !operations.held_lines.every((line: unknown) => typeof line === 'string')
      || !Array.isArray(operations.documents) || !Array.isArray(operations.requests) || !Array.isArray(operations.relationships)) return false;
  }
  return value.carriers.every((document: unknown) => isRecord(document) && typeof document.id === 'string'
    && Number.isSafeInteger(document.revision) && document.state === 'active' && isRecord(document.values)
    && Array.isArray(document.values.rules) && document.values.rules.every((rule: unknown) => isRecord(rule)
      && typeof rule.excerpt === 'string' && Number.isSafeInteger(rule.page))
    && (document.approved_by === null || typeof document.approved_by === 'string')
    && (document.approved_at === null || typeof document.approved_at === 'string'));
}
export function opportunityDatabaseError(error: { code?: string; message: string }): never {
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error.code ?? '')) {
    throw new WorkspaceError('Opportunity matching is not installed. Review and apply the carrier_appetite and opportunity_actions migrations before using this workspace.', 503);
  }
  throw databaseError(error);
}
export async function opportunityContext(db: SupabaseClient, actor: string, target: RecordTarget): Promise<OpportunityContext> {
  const result = await db.rpc('get_opportunity_context', { p_actor: actor, p_type: target.type, p_id: target.id });
  if (result.error) opportunityDatabaseError(result.error);
  const raw: unknown = result.data;
  if (!isOpportunityContext(raw)) throw new WorkspaceError('Opportunity evidence could not be verified.', 503);
  const context = raw;
  if (raw.settings !== undefined) {
    try { context.settings = parseOpportunitySettings(raw.settings); }
    catch (failure) {
      if (!(failure instanceof WorkspaceError)) throw failure;
      throw new WorkspaceError(`Stored opportunity settings are invalid: ${failure.message}`, 503);
    }
  }
  context.profile.profile = raw.profile.profile === null ? { ...EMPTY_OPPORTUNITY_PROFILE, facts: {} }
    : parseOpportunityProfile(raw.profile.profile, context.evaluated_on);
  for (const document of context.carriers) {
    // The source is intentionally omitted from matching; only previously reviewed values are used.
    const sourcePages = [...new Set([...document.values.rules.map((rule) => rule.page),
      ...(document.values.unresolved_entries ?? []).flatMap((entry) => entry.page === null ? [] : [entry.page])])]
      .map((page) => ({ page, text: document.values.rules.filter((rule) => rule.page === page).map((rule) => rule.excerpt).join('\n') }));
    parseCarrierAppetite(document.values, sourcePages);
  }
  return context;
}
export function opportunityWorkspace(context: OpportunityContext, target: RecordTarget): OpportunityWorkspace {
  const assessment = evaluateOpportunity(context.profile.profile, context.carriers, context.dossier, context.evaluated_on);
  const confirmationAge = (Date.parse(context.evaluated_on) - Date.parse(context.dossier.current_confirmation?.source_as_of ?? '')) / 86400000;
  const renewal = confirmationAge >= 0 && confirmationAge <= 90 ? confirmedDossierRenewal(context.dossier)?.date : undefined;
  for (const evidence of context.operations?.evidence ?? []) {
    const age = (Date.parse(context.evaluated_on) - Date.parse(evidence.source_as_of)) / 86400000;
    if (age < 0 || age > 90) continue;
    if (['authority', 'location'].includes(evidence.kind) && evidence.previous_as_of && evidence.previous_value) {
      assessment.briefing.signals.push({ title: evidence.kind === 'authority' ? 'Reviewed operating-authority change' : 'Reviewed business-location change',
        detail: `${evidence.previous_as_of}: ${evidence.previous_value}. ${evidence.source_as_of}: ${evidence.value}. Reference: ${evidence.reference}. Confirm identity and rule out corrections; this is not proof of growth.`,
        evidence_ids: [evidence.id], classification: 'needs_verification' });
    }
    if (evidence.kind === 'cross_sell') {
      assessment.briefing.questions.push(`Prospect-confirmed line to review: ${evidence.value}. Verify current held policies and needs; missing information is not a coverage gap.`);
    }
  }
  return { target, record_name: context.dossier.record_name, profile: context.profile, assessment,
    ...(context.settings ? { target_status: opportunityTarget(context.profile.profile, context.settings, renewal, context.evaluated_on) } : {}),
    evidence_token: context.evidence_token, evaluated_on: context.evaluated_on };
}
export function permissionFirstDraft(senderName: string, agency: string, line = ''): { subject: string; body: string } {
  const topic = line ? `${line} insurance` : 'business insurance';
  return { subject: 'Business insurance review',
    body: `Hello,\n\nI'm ${senderName} with ${agency}. Would a brief review of your ${topic} needs be useful?\n\nWe can start with the coverage lines, timing and priorities that matter to your business. If someone else handles insurance decisions, who is the best person to contact?\n\nWould you prefer a short call or to continue by email?\n\n${senderName}` };
}
