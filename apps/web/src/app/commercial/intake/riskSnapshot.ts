import type { CommercialIntakeBaseInput, RiskProfileMetadata } from './RiskEngine';
import { normalizeBooleanish } from './RiskEngine';

export interface RiskSnapshot {
  industry: string;
  gross_revenue: number;
  employees: number;
  payroll: number;
  has_property: boolean;
  property_sqft: number;
  has_autos: boolean;
  max_height_feet: number;
  performs_roofing: boolean;
  alcohol_sales_percentage: number;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildRiskSnapshot(base: CommercialIntakeBaseInput, meta: RiskProfileMetadata): RiskSnapshot {
  const workers = meta.modules?.workers_comp ?? {};
  const property = meta.modules?.property ?? {};
  const construction = meta.industry_specific?.construction ?? {};
  const hospitality = meta.industry_specific?.hospitality ?? {};

  return {
    industry: base.industry_group,
    gross_revenue: toNumber(base.gross_revenue),
    employees: base.has_employees ? toNumber(workers.employee_count) : 0,
    payroll: toNumber(workers.annual_payroll),
    has_property: Boolean(base.has_property),
    property_sqft: toNumber(property.sqft),
    has_autos: Boolean(base.has_autos),
    max_height_feet: toNumber(construction.max_height_feet),
    performs_roofing: normalizeBooleanish(construction.performs_roofing),
    alcohol_sales_percentage: toNumber(hospitality.alcohol_sales_percentage),
  };
}
