import { isRecord } from './workspace-validation';

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function websiteBusinessDetails(payload: Record<string, unknown>): { businessName: string | null; industry: string | null } {
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const review = isRecord(metadata.businessReview) ? metadata.businessReview : {};
  const profile = isRecord(payload.profile) ? payload.profile : {};
  const company = isRecord(profile.company) ? profile.company : {};
  const agentIntake = isRecord(payload.agent_intake) && isRecord(payload.agent_intake.answers) ? payload.agent_intake.answers : {};
  const agentBusiness = isRecord(agentIntake.business) ? agentIntake.business : {};
  const rawIndustry = string(review.industry) ?? string(company.industry) ?? string(agentBusiness.business_type);
  return {
    businessName: string(metadata.businessName) ?? string(payload.business_name),
    industry: rawIndustry && !['commercial', 'personal'].includes(rawIndustry.toLowerCase()) ? rawIndustry : null,
  };
}

export function sourceSubmissionId(payload: Record<string, unknown>): string | null {
  const id = payload.id ?? payload.submission_id;
  return typeof id === 'number' || typeof id === 'string' ? String(id).trim() || null : null;
}
