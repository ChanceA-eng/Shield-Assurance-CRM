'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  coerceFieldValue,
  isBooleanQuestion,
  isNumericQuestion,
  normalizeBooleanish,
  prettyLabel,
  riskEngine,
  type CommercialIntakeBaseInput,
  type IndustryKey,
  type RiskModuleKey,
  type RiskProfileMetadata,
} from './RiskEngine';
import { buildRiskSnapshot } from './riskSnapshot';
import { evaluateCarriers } from './carrierMatrix';
import { calculateCompleteness } from './completenessScore';

type FormState = Record<string, string | boolean>;

type CarrierResult = {
  eligible: boolean;
  reasons: string[];
};

export interface IntakeInsights {
  completenessScore: number;
  quoteReadiness: 'Not Started' | 'In Progress' | 'Ready to Quote';
  carrierMatrix: Record<string, CarrierResult>;
  underwritingFlags: string[];
  missingFields: string[];
}

interface IntakeFormProps {
  onInsightsChange?: (insights: IntakeInsights) => void;
}

const NAICS_LOOKUP_OPTIONS = [
  { code: '236220', label: 'Commercial and Institutional Building Construction' },
  { code: '238160', label: 'Roofing Contractors' },
  { code: '541511', label: 'Custom Computer Programming Services' },
  { code: '541612', label: 'Human Resources Consulting Services' },
  { code: '722513', label: 'Limited-Service Restaurants' },
  { code: '445110', label: 'Supermarkets and Other Grocery Retailers' },
  { code: '524210', label: 'Insurance Agencies and Brokerages' },
];

const FIELD_EXPLANATIONS: Record<string, string> = {
  legal_name: 'The exact name carriers use to issue the policy.',
  dba_name: 'Needed if the business operates under a different public name.',
  entity_type: 'Determines liability structure and rating rules.',
  fein: 'Required for underwriting and binding commercial policies.',
  physical_address: 'Carriers rate risk based on the physical location.',
  gross_revenue: 'Used to estimate exposure and determine eligibility.',
  years_experience: 'Underwriters use this to judge risk maturity.',
  has_employees: 'Triggers Workers Comp and payroll rating.',
  has_property: 'Triggers Property or BOP underwriting questions.',
  has_autos: 'Triggers Commercial Auto underwriting.',
  has_subcontractors: 'Triggers subcontractor liability controls.',
  is_physical_goods: 'Determines general liability exposure.',
  has_limitation_of_liability: 'Can reduce professional liability risk.',
  handles_sensitive_data: 'May trigger cyber underwriting.',
  max_height_feet: 'Carriers decline or surcharge above specific limits.',
  residential_percentage: 'Affects class code and pricing profile.',
  commercial_percentage: 'Affects class code and pricing profile.',
  performs_roofing: 'Roofing classes are high-risk for many carriers.',
  performs_structural: 'Structural work impacts hazard appetite.',
  performs_water_mitigation: 'Water work can trigger mold and exclusion review.',
  alcohol_sales_percentage: 'Higher alcohol share triggers liquor liability review.',
  has_delivery: 'Delivery activity can trigger HNOA coverage needs.',
  public_sqft: 'Public-facing area affects premises liability rating.',
};

const EXPOSURE_QUESTION_LABELS: Record<string, string> = {
  has_employees: 'Do you have employees?',
  has_property: 'Do you own or lease a building or equipment?',
  has_autos: 'Do you use vehicles for business?',
  has_subcontractors: 'Do you hire subcontractors?',
};

const INITIAL_STATE: FormState = {
  legal_name: '',
  dba_name: '',
  entity_type: '',
  fein: '',
  physical_address: '',
  gross_revenue: '',
  years_experience: '',
  industry_group: '',
  naics_code: '',
  has_employees: 'no',
  has_property: 'no',
  has_autos: 'no',
  has_subcontractors: 'no',
  legal_consent: false,
};

function readString(form: FormState, key: string): string {
  const value = form[key];
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value ?? '';
}

function buildPayload(form: FormState): { base: CommercialIntakeBaseInput; risk_profile_metadata: RiskProfileMetadata } {
  const base: CommercialIntakeBaseInput = {
    legal_name: readString(form, 'legal_name').trim(),
    dba_name: readString(form, 'dba_name').trim() || null,
    entity_type: readString(form, 'entity_type').trim(),
    fein: readString(form, 'fein').replace(/\D/g, ''),
    physical_address: readString(form, 'physical_address').trim(),
    gross_revenue: Number(readString(form, 'gross_revenue')) || 0,
    years_experience: Number(readString(form, 'years_experience')) || 0,
    has_employees: normalizeBooleanish(form.has_employees),
    has_subcontractors: normalizeBooleanish(form.has_subcontractors),
    has_property: normalizeBooleanish(form.has_property),
    has_autos: normalizeBooleanish(form.has_autos),
    industry_group: readString(form, 'industry_group').trim(),
    naics_code: readString(form, 'naics_code').replace(/\D/g, '') || '000000',
  };

  const modules = Object.entries(riskEngine.modules).reduce<Partial<Record<RiskModuleKey, Record<string, unknown>>>>((acc, [moduleKey, def]) => {
    const enabled = normalizeBooleanish(form[def.trigger_flag]);
    if (!enabled) return acc;

    const moduleValues = def.required_fields.reduce<Record<string, unknown>>((fields, fieldName) => {
      fields[fieldName] = coerceFieldValue(fieldName, form[fieldName]);
      return fields;
    }, {});

    acc[moduleKey as RiskModuleKey] = moduleValues;
    return acc;
  }, {});

  const industryGroup = readString(form, 'industry_group') as IndustryKey;
  const industryDefinition = riskEngine.industries[industryGroup];

  const industrySpecific: Record<string, Record<string, unknown>> = {};
  if (industryDefinition) {
    industrySpecific[industryGroup] = industryDefinition.questions.reduce<Record<string, unknown>>((acc, question) => {
      acc[question] = coerceFieldValue(question, form[question]);
      return acc;
    }, {});
  }

  return {
    base,
    risk_profile_metadata: {
      modules,
      industry_specific: industrySpecific,
    },
  };
}

function buildInsights(base: CommercialIntakeBaseInput, metadata: RiskProfileMetadata): IntakeInsights {
  const snapshot = buildRiskSnapshot(base, metadata);
  const completeness = calculateCompleteness(snapshot);
  const carrierMatrix = evaluateCarriers(snapshot);

  const underwritingFlags: string[] = [];
  if (base.has_subcontractors) underwritingFlags.push('Subcontractor exposure needs certificate controls.');
  if (base.has_autos) underwritingFlags.push('Vehicle schedules and driver MVRs required before binding.');
  if (snapshot.performs_roofing) underwritingFlags.push('Roofing exposure may restrict carrier options.');

  let quoteReadiness: IntakeInsights['quoteReadiness'] = 'Not Started';
  if (completeness.score >= 95) {
    quoteReadiness = 'Ready to Quote';
  } else if (completeness.score > 0) {
    quoteReadiness = 'In Progress';
  }

  return {
    completenessScore: completeness.score,
    carrierMatrix,
    quoteReadiness,
    underwritingFlags,
    missingFields: completeness.missing,
  };
}

export default function IntakeForm({ onInsightsChange }: IntakeFormProps): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeIndustry = readString(form, 'industry_group') as IndustryKey;
  const industryDefinition = riskEngine.industries[activeIndustry];

  const activeModules = useMemo(() => {
    return Object.entries(riskEngine.modules).reduce<Record<RiskModuleKey, boolean>>((acc, [moduleKey, definition]) => {
      acc[moduleKey as RiskModuleKey] = normalizeBooleanish(form[definition.trigger_flag]);
      return acc;
    }, {} as Record<RiskModuleKey, boolean>);
  }, [form]);

  useEffect(() => {
    const payload = buildPayload(form);
    onInsightsChange?.(buildInsights(payload.base, payload.risk_profile_metadata));
  }, [form, onInsightsChange]);

  const updateField = (field: string, value: string | boolean): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const feinValue = readString(form, 'fein');
  const feinDigits = feinValue.replace(/\D/g, '');
  const feinIsValid = feinDigits.length === 9;

  const naicsValue = readString(form, 'naics_code');
  const naicsDigits = naicsValue.replace(/\D/g, '');
  const naicsIsValid = naicsDigits.length === 6;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!form.legal_consent) {
      setError('Legal consent is required before submitting intake.');
      return;
    }

    if (!feinIsValid) {
      setError('FEIN must be 9 digits.');
      return;
    }

    if (!naicsIsValid) {
      setError('NAICS code must be 6 digits.');
      return;
    }

    const payload = buildPayload(form);

    setIsSubmitting(true);
    const response = await fetch('/commercial/intake/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        legal_consent: true,
      }),
    });

    if (!response.ok) {
      const responsePayload = (await response.json().catch(() => ({ message: 'Failed to submit intake.' }))) as { message?: string };
      setError(responsePayload.message ?? 'Failed to submit intake.');
      setIsSubmitting(false);
      return;
    }

    const responsePayload = (await response.json()) as { id: string };
    setIsSubmitting(false);
    setSuccessMessage(`Intake submitted successfully (ID: ${responsePayload.id}).`);
    router.push((`/commercial/intake?id=${responsePayload.id}`) as Route);
  };

  const renderQuestionField = (fieldName: string): JSX.Element => {
    if (isBooleanQuestion(fieldName)) {
      return (
        <select
          id={fieldName}
          className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
          value={readString(form, fieldName)}
          onChange={(event) => updateField(fieldName, event.target.value)}
          required
        >
          <option value="">Select</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    }

    return (
      <input
        id={fieldName}
        type={isNumericQuestion(fieldName) ? 'number' : 'text'}
        step={isNumericQuestion(fieldName) ? 'any' : undefined}
        className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
        value={readString(form, fieldName)}
        onChange={(event) => updateField(fieldName, event.target.value)}
        required
      />
    );
  };

  const renderFieldHelp = (fieldKey: string): JSX.Element | null => {
    const helper = FIELD_EXPLANATIONS[fieldKey];
    if (!helper) return null;
    return <span className="mt-1 block text-xs text-[#6a6a6a]">{helper}</span>;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <section className="rounded border border-[#ecebea] p-3">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#1f3f5b]">Tier 1: Global Required Fields</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-[#3e3e3c]">
            Legal Name
            <input className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'legal_name')} onChange={(e) => updateField('legal_name', e.target.value)} required />
            {renderFieldHelp('legal_name')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            DBA Name
            <input className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'dba_name')} onChange={(e) => updateField('dba_name', e.target.value)} />
            {renderFieldHelp('dba_name')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            Entity Type
            <select className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'entity_type')} onChange={(e) => updateField('entity_type', e.target.value)} required>
              <option value="">Select</option>
              <option value="LLC">LLC</option>
              <option value="S-Corp">S-Corp</option>
              <option value="C-Corp">C-Corp</option>
              <option value="Sole-Prop">Sole-Prop</option>
            </select>
            {renderFieldHelp('entity_type')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            FEIN
            <input
              className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
              value={readString(form, 'fein')}
              onChange={(e) => updateField('fein', e.target.value.replace(/[^\d-]/g, '').slice(0, 10))}
              placeholder="12-3456789"
              required
            />
            {renderFieldHelp('fein')}
            {!feinIsValid && feinValue.length > 0 ? <span className="mt-1 block text-xs text-rose-700">Enter 9 digits.</span> : null}
          </label>
          <label className="text-sm text-[#3e3e3c] md:col-span-2">
            Physical Address
            <input className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'physical_address')} onChange={(e) => updateField('physical_address', e.target.value)} required />
            {renderFieldHelp('physical_address')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            Gross Revenue
            <input type="number" step="any" className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'gross_revenue')} onChange={(e) => updateField('gross_revenue', e.target.value)} required />
            {renderFieldHelp('gross_revenue')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            Years Experience
            <input type="number" className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'years_experience')} onChange={(e) => updateField('years_experience', e.target.value)} required />
            {renderFieldHelp('years_experience')}
          </label>
          <label className="text-sm text-[#3e3e3c]">
            Industry Group
            <select className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={readString(form, 'industry_group')} onChange={(e) => updateField('industry_group', e.target.value)} required>
              <option value="">Select</option>
              {Object.entries(riskEngine.industries).map(([key, industry]) => (
                <option key={key} value={key}>
                  {industry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#3e3e3c]">
            NAICS Code
            <input
              className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
              value={readString(form, 'naics_code')}
              onChange={(e) => updateField('naics_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="524210"
              list="naics-options"
              required
            />
            <span className="mt-1 block text-xs text-[#6a6a6a]">Classifies business operations for carrier eligibility and pricing.</span>
            {!naicsIsValid && naicsValue.length > 0 ? <span className="mt-1 block text-xs text-rose-700">Use a 6 digit NAICS code.</span> : null}
            <datalist id="naics-options">
              {NAICS_LOOKUP_OPTIONS.map((option) => (
                <option key={option.code} value={option.code} label={option.label} />
              ))}
            </datalist>
          </label>
        </div>
      </section>

      <section className="rounded border border-[#ecebea] p-3">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#1f3f5b]">Tier 2: Exposure Modules</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(riskEngine.modules).map(([moduleKey, moduleDefinition]) => (
            <label key={moduleKey} className="text-sm text-[#3e3e3c]">
              {EXPOSURE_QUESTION_LABELS[moduleDefinition.trigger_flag] ?? moduleDefinition.label}
              <select
                className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={readString(form, moduleDefinition.trigger_flag)}
                onChange={(event) => updateField(moduleDefinition.trigger_flag, event.target.value)}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
              {renderFieldHelp(moduleDefinition.trigger_flag)}
            </label>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          {Object.entries(riskEngine.modules).map(([moduleKey, moduleDefinition]) => {
            if (!activeModules[moduleKey as RiskModuleKey]) return null;

            return (
              <div key={moduleKey} className="rounded border border-[#dddbda] bg-[#f8f8f7] p-3">
                <p className="mb-2 text-sm font-semibold text-[#1f3f5b]">{moduleDefinition.label}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {moduleDefinition.required_fields.map((fieldName) => (
                    <label key={fieldName} className="text-sm text-[#3e3e3c]">
                      {prettyLabel(fieldName)}
                      {renderQuestionField(fieldName)}
                      {renderFieldHelp(fieldName)}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {industryDefinition ? (
        <section className="rounded border border-[#ecebea] p-3">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#1f3f5b]">Tier 3: {industryDefinition.label}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {industryDefinition.questions.map((question) => (
              <label key={question} className="text-sm text-[#3e3e3c]">
                {prettyLabel(question)}
                {renderQuestionField(question)}
                {renderFieldHelp(question)}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded border border-[#ecebea] p-3">
        <label className="flex gap-2 text-sm text-[#3e3e3c]">
          <input type="checkbox" checked={Boolean(form.legal_consent)} onChange={(e) => updateField('legal_consent', e.target.checked)} required />
          <span>
            By submitting this form, the applicant authorizes Shield Assurance LLC to act as their insurance broker and consents to the
            collection of business data, vehicle records, and relevant underwriting history to obtain coverage options from commercial carriers.
          </span>
        </label>
      </section>

      {error ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {successMessage ? <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <button type="submit" disabled={isSubmitting} className="rounded border border-[#0163b3] bg-[#0176d3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:opacity-70">
        {isSubmitting ? 'Submitting Intake...' : 'Submit Intake'}
      </button>
    </form>
  );
}
