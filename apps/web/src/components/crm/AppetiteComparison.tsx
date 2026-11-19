'use client';
import { BUSINESS_FIELDS, NUMERIC_BUSINESS_FIELDS, type AppetitePredicate, type BusinessField } from '@crm/shared';

const fieldLabels: Record<BusinessField, string> = {
  state: 'State', line: 'Coverage (e.g. General liability)', class_code: 'Business class code', industry: 'Industry',
  years_in_business: 'Years in business', annual_revenue: 'Annual revenue ($)', power_units: 'Trucks (power units)',
  operating_radius_miles: 'Operating radius (miles)', has_delivery: 'Offers delivery?', has_prior_losses: 'Has prior losses?',
  experience_mod: 'Workers’ comp experience mod', annual_payroll: 'Audited annual payroll ($)',
};
const examples: Record<BusinessField, string> = {
  state: 'AZ, NV', line: 'General liability', class_code: 'Code stated in the guide', industry: 'Restaurants',
  years_in_business: '3', annual_revenue: '1000000', power_units: '10', operating_radius_miles: '50',
  has_delivery: 'no', has_prior_losses: 'no',
  experience_mod: '1.00', annual_payroll: '1000000',
};

export default function AppetiteComparison({ value, onChange }: { value?: AppetitePredicate; onChange: (value: AppetitePredicate | undefined) => void }): JSX.Element {
  const control = 'rounded border border-cui-border bg-white px-2 py-1 text-xs';
  return <details className="text-xs sm:col-span-3">
    <summary className="cursor-pointer text-cui-primary">{value ? 'Automatic matching rule' : 'Add automatic matching (optional)'}</summary>
    <p className="mt-2 text-cui-muted">Choose which business detail to check and the limit from the guide. For “at least 3 years in business”, choose Years in business, At least, and 3. Leave complex requirements for an underwriter to review.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <label className="space-y-1">Business detail
      <select aria-label="Matching business field" className={control} value={value?.field ?? ''} onChange={(event) => {
        const field = BUSINESS_FIELDS.find((entry) => entry === event.target.value);
        onChange(field ? { field, operator: 'is', value: '' } : undefined);
      }}>
        <option value="">Review manually</option>
        {BUSINESS_FIELDS.map((field) => <option key={field} value={field}>{fieldLabels[field]}</option>)}
      </select>
      </label>
      {value ? <>
        <label className="space-y-1">Must be
        <select aria-label="Matching comparison" className={control} value={value.operator} onChange={(event) => {
          const operator = ['is', 'in', 'gte', 'lte'].find((entry) => entry === event.target.value);
          if (operator) onChange({ ...value, operator: operator as AppetitePredicate['operator'] });
        }}>
          <option value="is">Exactly</option>
          {NUMERIC_BUSINESS_FIELDS.some((field) => field === value.field) ? <><option value="gte">At least</option><option value="lte">No more than</option></> : <option value="in">One of these</option>}
        </select>
        </label>
        <label className="space-y-1">Value from the guide
          {value.field === 'has_delivery' || value.field === 'has_prior_losses' ? <select aria-label="Documented comparison value" className={control} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })}>
            <option value="">Choose yes or no</option><option value="yes">Yes</option><option value="no">No</option>
          </select> : <input aria-label="Documented comparison value" className={control} value={value.value} maxLength={500}
            placeholder={`Example: ${examples[value.field]}`} onChange={(event) => onChange({ ...value, value: event.target.value })} />}
        </label>
        {value.operator === 'in' ? <p className="w-full text-cui-muted">Separate each allowed value with a comma, for example AZ, NV.</p> : null}
      </> : null}
    </div>
  </details>;
}
