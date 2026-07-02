'use client';

import { useMemo, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { personalEngine, type PersonalModuleKey } from '../PersonalEngine';

type FormState = Record<string, string> & { legal_consent: string };

const FIELD_HELP: Record<string, string> = {
  first_name: 'Used for quoting, binding, and matching carrier records.',
  last_name: 'Required for all personal lines applications.',
  dob: 'Carriers use DOB to rate drivers and validate identity.',
  primary_phone: 'Used for quote delivery and renewal reminders.',
  primary_email: 'Required for sending quotes and policy documents.',
  street_address: 'Determines home rating factors and auto garaging territory.',
  city: 'Used to calculate territory and catastrophe exposure.',
  state: 'State regulations and rates vary by jurisdiction.',
  zip_code: 'Drives territory, weather, and theft-rating factors.',
  current_carrier: 'Helps position replacement options and retention timing.',
  current_policy_expiration: 'Critical for renewal timing and remarketing.',
  credit_score_tier: 'Used by carriers for personal lines rating tiers.',
  quote_auto: 'Enables the Auto module (drivers, vehicles, limits).',
  quote_home: 'Enables the Homeowners module (roof, year built, updates).',
  quote_umbrella: 'Umbrella requires minimum auto/home liability limits.',
  driver_count: 'Carriers rate per driver and household risk profile.',
  vehicle_count: 'Each vehicle has unique VIN and rating factors.',
  prior_liability_limits: 'Determines eligibility and pricing tiers.',
  year_built: 'Determines age-related risk and eligibility.',
  roof_material: 'Some roof types trigger exclusions or pricing shifts.',
  has_pool: 'Pools increase premises liability exposure.',
  dog_breed: 'Certain breeds trigger underwriting restrictions.',
  required_underlying_limits: 'Umbrella requires specific underlying liability limits.',
};

const INITIAL_FORM: FormState = {
  first_name: '',
  last_name: '',
  dob: '',
  primary_phone: '',
  primary_email: '',
  street_address: '',
  city: '',
  state: 'AZ',
  zip_code: '',
  current_carrier: '',
  current_policy_expiration: '',
  credit_score_tier: '',
  quote_auto: 'no',
  quote_home: 'no',
  quote_umbrella: 'no',
  legal_consent: 'no',
};

function toLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NewPersonalSubmission(): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [modules, setModules] = useState<Record<PersonalModuleKey, boolean>>({
    auto_line: false,
    property_line: false,
    umbrella_line: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moduleEntries = useMemo(
    () => Object.entries(personalEngine.personal_modules) as Array<[PersonalModuleKey, (typeof personalEngine.personal_modules)[PersonalModuleKey]]>,
    [],
  );

  const updateField = (key: string, value: string): void => {
    setForm((prev) => ({ ...prev, [key]: value }));

    for (const [moduleKey, moduleDef] of moduleEntries) {
      if (moduleDef.trigger_flag === key) {
        setModules((prev) => ({ ...prev, [moduleKey]: value === 'yes' }));
      }
    }
  };

  const renderHelp = (key: string): JSX.Element | null => {
    const message = FIELD_HELP[key];
    if (!message) return null;
    return <p className="mt-1 text-xs text-[#6a6a6a]">{message}</p>;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (form.legal_consent !== 'yes') {
      setError('Consent is required before submitting.');
      return;
    }

    setIsSubmitting(true);
    const response = await fetch('/personal/api/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form, modules }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to create personal submission.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create personal submission.');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    router.push('/personal' as Route);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-4">
      <div>
        <h2 className="text-lg font-bold text-[#080707]">New Personal Submission</h2>
        <p className="text-sm text-[#3e3e3c]">Capture personal lines data for Auto, Home, and Umbrella quoting.</p>
      </div>

      <section className="rounded border border-[#ecebea] p-3">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#1f3f5b]">Identity and Contact</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {['first_name', 'last_name', 'dob', 'primary_phone', 'primary_email', 'street_address', 'city', 'state', 'zip_code', 'current_carrier', 'current_policy_expiration', 'credit_score_tier'].map((key) => (
            <label key={key} className={`text-sm text-[#3e3e3c] ${key === 'street_address' ? 'md:col-span-2' : ''}`}>
              {toLabel(key)}
              <input
                type={key.includes('date') || key === 'dob' ? 'date' : key.includes('email') ? 'email' : 'text'}
                className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={form[key] ?? ''}
                onChange={(e) => updateField(key, e.target.value)}
                required={['first_name', 'last_name', 'dob', 'primary_phone', 'primary_email', 'street_address', 'city', 'state', 'zip_code'].includes(key)}
              />
              {renderHelp(key)}
            </label>
          ))}
        </div>
      </section>

      <section className="rounded border border-[#ecebea] p-3">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#1f3f5b]">Coverage Modules</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {moduleEntries.map(([moduleKey, moduleDef]) => (
            <label key={moduleKey} className="text-sm text-[#3e3e3c]">
              {moduleDef.label}
              <select
                className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={form[moduleDef.trigger_flag] ?? 'no'}
                onChange={(e) => updateField(moduleDef.trigger_flag, e.target.value)}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
              {renderHelp(moduleDef.trigger_flag)}
            </label>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          {moduleEntries.map(([moduleKey, moduleDef]) => {
            if (!modules[moduleKey]) return null;

            return (
              <div key={moduleKey} className="rounded border border-[#dddbda] bg-[#f8f8f7] p-3">
                <p className="mb-2 text-sm font-semibold text-[#1f3f5b]">{moduleDef.label}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {moduleDef.required_fields.map((field) => (
                    <label key={field} className="text-sm text-[#3e3e3c]">
                      {toLabel(field)}
                      {field.startsWith('has_') ? (
                        <select
                          className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          value={form[field] ?? 'no'}
                          onChange={(e) => updateField(field, e.target.value)}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      ) : (
                        <input
                          className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                          value={form[field] ?? ''}
                          onChange={(e) => updateField(field, e.target.value)}
                          required
                        />
                      )}
                      {renderHelp(field)}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded border border-[#ecebea] p-3">
        <label className="text-sm text-[#3e3e3c]">
          Consent To Retrieve Policy Data
          <select className="mt-1 w-full rounded border border-[#dddbda] px-3 py-2 text-sm" value={form.legal_consent} onChange={(e) => updateField('legal_consent', e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
          <p className="mt-1 text-xs text-[#6a6a6a]">Authorizes policy data collection and underwriting use for quote generation.</p>
        </label>
      </section>

      {error ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded border border-[#0163b3] bg-[#0176d3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Personal Intake'}
      </button>
    </form>
  );
}
