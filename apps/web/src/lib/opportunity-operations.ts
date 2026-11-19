import { DEFAULT_OPPORTUNITY_SETTINGS, OPPORTUNITY_STAGES, validEvidenceDate,
  type OpportunityProfile, type OpportunitySettings, type OpportunityStage } from '@crm/shared';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';

const tokens = (text: string): string[] => text.split(/[,;\n]/).map((part) => part.trim().toLowerCase()).filter(Boolean);
export function parseOpportunitySettings(value: unknown): OpportunitySettings {
  if (!isRecord(value)) throw new WorkspaceError('Provide OIP settings.', 400);
  const result = { ...DEFAULT_OPPORTUNITY_SETTINGS };
  if (Object.keys(value).some((key) => !(key in result))) throw new WorkspaceError('An unsupported OIP setting was supplied.', 400);
  for (const key of ['industries', 'states', 'lines', 'excluded_industries'] as const) {
    if (typeof value[key] !== 'string' || value[key].length > 1000) throw new WorkspaceError('Target lists must be text of at most 1000 characters.', 400);
    result[key] = value[key].trim();
  }
  if (tokens(result.states).some((state) => !/^[a-z]{2}$/.test(state))) throw new WorkspaceError('Use comma-separated two-letter state codes.', 400);
  for (const key of ['revenue_min', 'revenue_max'] as const) {
    const number = value[key];
    if (number !== null && (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1e15)) throw new WorkspaceError('Revenue limits must be nonnegative numbers or blank.', 400);
    result[key] = number;
  }
  if (result.revenue_min !== null && result.revenue_max !== null && result.revenue_min > result.revenue_max) throw new WorkspaceError('Minimum revenue must not exceed maximum revenue.', 400);
  for (const [key, min, max] of [['renewal_days', 1, 365], ['agent_capacity', 1, 100], ['refresh_days', 1, 365], ['digest_hour', 0, 23]] as const) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) throw new WorkspaceError(`${key.replace(/_/g, ' ')} must be between ${min} and ${max}.`, 400);
    result[key] = number;
  }
  if (typeof value.recurring_enabled !== 'boolean') throw new WorkspaceError('Choose whether recurring internal evaluation is enabled.', 400);
  result.recurring_enabled = value.recurring_enabled;
  return result;
}
export function opportunityTarget(profile: OpportunityProfile, settings: OpportunitySettings, renewalDate?: string, today = new Date().toISOString().slice(0, 10)): 'targeted' | 'unknown' | 'outside_target' {
  let unknown = !validEvidenceDate(renewalDate);
  if (validEvidenceDate(renewalDate)) {
    const days = (Date.parse(renewalDate) - Date.parse(today)) / 86400000;
    if (days < 0 || days > settings.renewal_days) return 'outside_target';
  }
  const industry = profile.facts.industry?.trim().toLowerCase();
  if (industry && tokens(settings.excluded_industries).includes(industry)) return 'outside_target';
  for (const [key, list] of [['industry', settings.industries], ['state', settings.states], ['line', settings.lines]] as const) {
    if (!list.trim()) continue;
    const fact = profile.facts[key]?.trim().toLowerCase();
    if (!fact) unknown = true;
    else if (!tokens(list).includes(fact)) return 'outside_target';
  }
  if (settings.revenue_min !== null || settings.revenue_max !== null) {
    const value = profile.facts.annual_revenue;
    if (!value) unknown = true;
    else if (settings.revenue_min !== null && Number(value) < settings.revenue_min
      || settings.revenue_max !== null && Number(value) > settings.revenue_max) return 'outside_target';
  }
  return unknown ? 'unknown' : 'targeted';
}
export function parseOpportunityOutcome(value: unknown, today = new Date().toISOString().slice(0, 10)): {
  stage: OpportunityStage; occurred_on: string; reason: string; source: string; cost: number; premium: number | null;
} {
  if (!isRecord(value) || !OPPORTUNITY_STAGES.some((stage) => stage === value.stage)
    || !validEvidenceDate(value.occurred_on) || value.occurred_on > today
    || typeof value.reason !== 'string' || value.reason.length > 1000
    || typeof value.source !== 'string' || !value.source.trim() || value.source.length > 500
    || typeof value.cost !== 'number' || !Number.isFinite(value.cost) || value.cost < 0 || value.cost > 1e9
    || value.premium !== null && (typeof value.premium !== 'number' || !Number.isFinite(value.premium) || value.premium < 0 || value.premium > 1e12)) {
    throw new WorkspaceError('Record a valid outcome date, source attribution and nonnegative cost/premium.', 400);
  }
  const stage = value.stage as OpportunityStage;
  if (['declined', 'lost'].includes(stage) && !value.reason.trim()) throw new WorkspaceError('Record the decline or loss reason.', 400);
  if (!['quote', 'bound'].includes(stage) && value.premium !== null) throw new WorkspaceError('Only quoted or bound outcomes can record actual premium.', 400);
  return { stage, occurred_on: value.occurred_on, reason: value.reason.trim(), source: value.source.trim(), cost: value.cost, premium: value.premium };
}
