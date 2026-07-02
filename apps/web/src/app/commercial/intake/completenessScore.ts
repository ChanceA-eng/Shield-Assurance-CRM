import type { RiskSnapshot } from './riskSnapshot';

export interface CompletenessResult {
  score: number;
  missing: string[];
}

export function calculateCompleteness(snapshot: RiskSnapshot): CompletenessResult {
  let score = 100;
  const missing: string[] = [];

  if (!snapshot.industry) {
    score -= 20;
    missing.push('industry_group');
  }
  if (!snapshot.gross_revenue) {
    score -= 10;
    missing.push('gross_revenue');
  }
  if (snapshot.employees && !snapshot.payroll) {
    score -= 10;
    missing.push('annual_payroll');
  }
  if (snapshot.has_property && !snapshot.property_sqft) {
    score -= 10;
    missing.push('property_sqft');
  }
  if (snapshot.max_height_feet === 0 && snapshot.industry === 'construction') {
    score -= 10;
    missing.push('max_height_feet');
  }

  return { score: Math.max(0, score), missing };
}
