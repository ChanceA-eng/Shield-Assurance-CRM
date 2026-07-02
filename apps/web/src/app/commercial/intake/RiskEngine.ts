export const riskEngine = {
  modules: {
    workers_comp: {
      trigger_flag: 'has_employees',
      required_fields: ['employee_count', 'annual_payroll'],
      label: "Workers' Compensation",
    },
    property: {
      trigger_flag: 'has_property',
      required_fields: ['sqft', 'construction_type', 'roof_year'],
      label: 'Property / BOP',
    },
    commercial_auto: {
      trigger_flag: 'has_autos',
      required_fields: ['vin_list', 'drivers', 'radius'],
      label: 'Commercial Auto',
    },
    subcontractors: {
      trigger_flag: 'has_subcontractors',
      required_fields: ['annual_sub_cost', 'requires_equal_limits', 'requires_coi'],
      label: 'Subcontractor Risk',
    },
  },
  industries: {
    tech: {
      label: 'Tech / Professional Services',
      questions: ['is_physical_goods', 'has_limitation_of_liability', 'handles_sensitive_data'],
    },
    construction: {
      label: 'Construction / Trades',
      questions: [
        'max_height_feet',
        'residential_percentage',
        'commercial_percentage',
        'performs_roofing',
        'performs_structural',
        'performs_water_mitigation',
      ],
    },
    hospitality: {
      label: 'Hospitality / Food / Retail',
      questions: ['alcohol_sales_percentage', 'has_delivery', 'public_sqft'],
    },
  },
  carrier_rules: {
    travelers: { max_height_feet: 3, allow_roofing: false },
    next: { max_height_feet: 2, allow_roofing: false },
    hiscox: { max_height_feet: 5, allow_roofing: true },
  },
} as const;

export type RiskModuleKey = keyof typeof riskEngine.modules;
export type IndustryKey = keyof typeof riskEngine.industries;

export interface CommercialIntakeBaseInput {
  legal_name: string;
  dba_name: string | null;
  entity_type: string;
  fein: string;
  physical_address: string;
  gross_revenue: number;
  years_experience: number;
  has_employees: boolean;
  has_subcontractors: boolean;
  has_property: boolean;
  has_autos: boolean;
  industry_group: string;
  naics_code: string;
}

export interface RiskProfileMetadata {
  modules: Partial<Record<RiskModuleKey, Record<string, unknown>>>;
  industry_specific: Record<string, Record<string, unknown>>;
}

type CarrierEvaluation = {
  eligible: boolean;
  reasons: string[];
};

const BOOLEAN_PREFIXES = ['is_', 'has_', 'performs_', 'requires_'];
const NUMERIC_HINTS = ['count', 'payroll', 'sqft', 'year', 'radius', 'cost', 'height', 'percentage', 'revenue'];

export function prettyLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isBooleanQuestion(fieldName: string): boolean {
  return BOOLEAN_PREFIXES.some((prefix) => fieldName.startsWith(prefix));
}

export function isNumericQuestion(fieldName: string): boolean {
  return NUMERIC_HINTS.some((token) => fieldName.includes(token));
}

export function normalizeBooleanish(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

export function hasValue(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function coerceFieldValue(fieldName: string, value: unknown): string | number | boolean | null {
  if (!hasValue(value)) return null;

  if (isBooleanQuestion(fieldName)) {
    return normalizeBooleanish(value);
  }

  if (isNumericQuestion(fieldName)) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  return String(value).trim();
}

function readIndustryAnswers(metadata: RiskProfileMetadata, industryGroup: string): Record<string, unknown> {
  const branch = metadata.industry_specific[industryGroup];
  return branch && typeof branch === 'object' ? branch : {};
}

export function buildRiskSnapshot(base: CommercialIntakeBaseInput, metadata: RiskProfileMetadata): Record<string, unknown> {
  const industryAnswers = readIndustryAnswers(metadata, base.industry_group);
  const enabledModules = Object.keys(metadata.modules);

  return {
    industry_group: base.industry_group,
    naics_code: base.naics_code,
    exposures: {
      has_employees: base.has_employees,
      has_property: base.has_property,
      has_autos: base.has_autos,
      has_subcontractors: base.has_subcontractors,
    },
    enabled_modules: enabledModules,
    industry_answers: industryAnswers,
  };
}

export function calculateCompleteness(base: CommercialIntakeBaseInput, metadata: RiskProfileMetadata): number {
  const requiredFields: Array<{ key: string; value: unknown }> = [
    { key: 'legal_name', value: base.legal_name },
    { key: 'entity_type', value: base.entity_type },
    { key: 'fein', value: base.fein },
    { key: 'physical_address', value: base.physical_address },
    { key: 'gross_revenue', value: base.gross_revenue },
    { key: 'years_experience', value: base.years_experience },
    { key: 'industry_group', value: base.industry_group },
    { key: 'naics_code', value: base.naics_code },
  ];

  for (const [moduleKey, moduleDefinition] of Object.entries(riskEngine.modules) as Array<[
    RiskModuleKey,
    (typeof riskEngine.modules)[RiskModuleKey],
  ]>) {
    const modulePayload = metadata.modules[moduleKey];
    if (!modulePayload) continue;

    for (const requiredField of moduleDefinition.required_fields) {
      requiredFields.push({ key: requiredField, value: modulePayload[requiredField] });
    }
  }

  const industryDefinition = riskEngine.industries[base.industry_group as IndustryKey];
  const industryAnswers = readIndustryAnswers(metadata, base.industry_group);

  if (industryDefinition) {
    for (const question of industryDefinition.questions) {
      requiredFields.push({ key: question, value: industryAnswers[question] });
    }
  }

  const populated = requiredFields.filter((entry) => hasValue(entry.value)).length;
  return Math.round((populated / requiredFields.length) * 100);
}

export function evaluateCarrierMatrix(base: CommercialIntakeBaseInput, metadata: RiskProfileMetadata): Record<string, CarrierEvaluation> {
  const industryAnswers = readIndustryAnswers(metadata, base.industry_group);
  const maxHeightRaw = industryAnswers.max_height_feet;
  const maxHeight = typeof maxHeightRaw === 'number' ? maxHeightRaw : Number(maxHeightRaw ?? 0);
  const performsRoofing = normalizeBooleanish(industryAnswers.performs_roofing);

  return Object.entries(riskEngine.carrier_rules).reduce<Record<string, CarrierEvaluation>>((acc, [carrier, rule]) => {
    const reasons: string[] = [];

    if (Number.isFinite(maxHeight) && maxHeight > 0 && maxHeight > rule.max_height_feet) {
      reasons.push(`Height exceeds ${rule.max_height_feet} stories.`);
    }

    if (performsRoofing && !rule.allow_roofing) {
      reasons.push('Roofing exposure is not accepted.');
    }

    acc[carrier] = {
      eligible: reasons.length === 0,
      reasons,
    };

    return acc;
  }, {});
}
