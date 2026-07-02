import { riskEngine } from './RiskEngine';
import type { RiskSnapshot } from './riskSnapshot';

export interface CarrierCompatibility {
  eligible: boolean;
  reasons: string[];
}

export function evaluateCarriers(snapshot: RiskSnapshot): Record<string, CarrierCompatibility> {
  const matrix: Record<string, CarrierCompatibility> = {};

  Object.entries(riskEngine.carrier_rules).forEach(([carrier, rules]) => {
    const reasons: string[] = [];

    const heightOK = !rules.max_height_feet || snapshot.max_height_feet <= rules.max_height_feet;
    if (!heightOK) reasons.push(`Height exceeds ${rules.max_height_feet} stories.`);

    const roofingOK = rules.allow_roofing || !snapshot.performs_roofing;
    if (!roofingOK) reasons.push('Roofing exposure is not accepted.');

    matrix[carrier] = {
      eligible: heightOK && roofingOK,
      reasons,
    };
  });

  return matrix;
}
