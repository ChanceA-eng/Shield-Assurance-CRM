'use client';

import { useState } from 'react';
import { EMPLOYMENT_STATUSES, OCCUPATIONS, type ApplicantDetails } from '../../lib/applicant-details';
import { OCCUPATION_INDUSTRIES, occupationIndustry, occupationsForIndustry } from '../../lib/occupation-industries';

const input = 'crm-input mt-1';
export default function ApplicantDetailsFields({ value, onChange, disabled = false, personal = true }: {
  value: ApplicantDetails; onChange: (value: ApplicantDetails) => void; disabled?: boolean; personal?: boolean;
}): JSX.Element {
  const [other, setOther] = useState(Boolean(value.occupation && !value.occupation_code));
  const industry = value.occupation_industry || occupationIndustry(value.occupation_code) || (other ? 'other' : '');
  const update = (key: keyof ApplicantDetails, next: string): void => onChange({ ...value, [key]: next });
  const field = (label: string, key: Exclude<keyof ApplicantDetails, 'previous_addresses'>, type = 'text') => (
    <label className="block text-xs font-semibold text-cui-muted">{label}
      <input type={type} className={input} value={value[key]} min={type === 'number' ? 0 : undefined}
        max={key === 'months_at_address' ? 11 : type === 'number' ? 120 : undefined} onChange={(event) => update(key, event.target.value)} />
    </label>
  );
  const select = (label: string, key: 'marital_status' | 'employment_status' | 'residence_status', options: readonly string[]) => (
    <label className="block text-xs font-semibold text-cui-muted">{label}<select className={input} value={value[key]} onChange={(event) => update(key, event.target.value)}>
      <option value="">Not recorded</option>{options.map((option) => <option key={option}>{option}</option>)}
    </select></label>
  );
  const options = occupationsForIndustry(industry);
  return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2" aria-label="Optional applicant information">
    {personal ? <>
      {field('Date of birth', 'dob', 'date')}
      {select('Marital status', 'marital_status', ['Single', 'Married', 'Domestic partner', 'Divorced', 'Widowed'])}
      <div className="space-y-2 sm:col-span-2">
        <label className="block text-xs font-semibold text-cui-muted">Industry
          <select className={input} value={industry} onChange={(event) => {
            setOther(event.target.value === 'other');
            onChange({ ...value, occupation_industry: event.target.value, occupation_code: '', occupation: '' });
          }}>
            <option value="">Select industry</option>
            {OCCUPATION_INDUSTRIES.map((row) => <option key={row.code} value={row.code}>{row.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-cui-muted">Occupation
          <select className={input} disabled={!industry} value={other ? 'other' : value.occupation_code} onChange={(event) => {
            const selected = OCCUPATIONS.find((row) => row.code === event.target.value);
            setOther(event.target.value === 'other');
            onChange({ ...value, occupation_code: selected?.code ?? '', occupation: selected?.title ?? '' });
          }}>
            <option value="">Select occupation</option>
            {options.map((row) => <option key={row.code} value={row.code}>{row.title}</option>)}
            <option value="other">Other - enter manually</option>
          </select>
        </label>
        {other ? field('Other occupation', 'occupation') : null}
      </div>
      {select('Employment status', 'employment_status', EMPLOYMENT_STATUSES)}
      {field('Employer', 'employer')}
      {field('Years with employer', 'years_employed', 'number')}
    </> : null}
    {field('Requested coverage effective date', 'requested_effective', 'date')}
    {field('Requested coverage expiration date', 'requested_expiration', 'date')}
  </fieldset>;
}
