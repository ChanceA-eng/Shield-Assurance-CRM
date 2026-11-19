export const LEGACY_DEAL_BOUND_AUTOMATION_ENV = 'CRM_LEGACY_DEAL_BOUND_AUTOMATION_ENABLED';

export function isLegacyDealBoundAutomationEnabled(value: string | undefined): boolean {
  return value === 'true';
}
