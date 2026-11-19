'use client';

import { EMPTY_DRIVER, LICENSE_STATUSES, RESIDENCE_STATUSES, type IntakeDriver, type PreviousAddress } from '../../lib/applicant-details';
import { DRIVER_RELATIONSHIPS, US_STATES } from '../../lib/agent-lead-intake';
const input = 'crm-input mt-1';
export default function DriverIntakeFields({ drivers, onChange, disabled = false, state = '', applicantAddress = '' }: {
  drivers: IntakeDriver[]; onChange: (drivers: IntakeDriver[]) => void; disabled?: boolean; state?: string; applicantAddress?: string;
}): JSX.Element {
  const update = (index: number, key: keyof IntakeDriver, value: string): void => onChange(drivers.map((row, position) => position === index ? { ...row, [key]: value } : row));
  const updateHistory = (index: number, previous_addresses: PreviousAddress[]): void =>
    onChange(drivers.map((row, position) => position === index ? { ...row, previous_addresses } : row));
  return <fieldset disabled={disabled} className="space-y-3" aria-label="Drivers">
    {drivers.map((driver, index) => <fieldset key={index} className="grid gap-3 rounded border border-cui-border p-3 sm:grid-cols-2" aria-label={`Driver ${index + 1}`}>
      {([['name', 'name', 'text'], ['dob', 'date of birth', 'date'], ['license_number', 'license number', 'text'],
        ['license_class', 'license class', 'text'], ['license_issued', 'license issue date', 'date'], ['license_expires', 'license expiration date', 'date'],
        ['years_licensed', 'years licensed', 'number']] as const).map(([key, label, type]) =>
        <label key={key} className="text-xs font-semibold text-cui-muted">Driver {index + 1} {label}
          <input className={input} type={type} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 120 : undefined}
            autoComplete={key === 'license_number' ? 'off' : undefined} value={driver[key] ?? ''} onChange={(event) => update(index, key, event.target.value)} />
        </label>)}
      {([['relationship', 'relationship', DRIVER_RELATIONSHIPS], ['license_state', 'license state', US_STATES], ['license_status', 'license status', LICENSE_STATUSES]] as const).map(([key, label, options]) =>
        <label key={key} className="text-xs font-semibold text-cui-muted">Driver {index + 1} {label}
          <select value={driver[key] ?? ''} className={input} onChange={(event) => update(index, key, event.target.value)}>
            <option value="">Not recorded</option>{options.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>)}
      <label className="text-xs font-semibold text-cui-muted sm:col-span-2">Driver {index + 1} address
        <input className={input} value={driver.address ?? ''} maxLength={300} onChange={(event) => update(index, 'address', event.target.value)} />
      </label>
      {(['years_at_address', 'months_at_address'] as const).map((key) => <label key={key} className="text-xs font-semibold text-cui-muted">
        Driver {index + 1} {key === 'years_at_address' ? 'years at current address' : 'additional months at current address'}
        <input className={input} type="number" min={0} max={key === 'months_at_address' ? 11 : 120} value={driver[key] ?? ''}
          onChange={(event) => update(index, key, event.target.value)} />
      </label>)}
      <label className="text-xs font-semibold text-cui-muted">Driver {index + 1} residence status
        <select className={input} value={driver.residence_status ?? ''} onChange={(event) => update(index, 'residence_status', event.target.value)}>
          <option value="">Not recorded</option>{RESIDENCE_STATUSES.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <div className="space-y-2 sm:col-span-2">
        {(driver.previous_addresses ?? []).map((row, position) => <fieldset key={position} className="grid gap-2 rounded border border-cui-border p-2 sm:grid-cols-2" aria-label={`Driver ${index + 1} previous address ${position + 1}`}>
          {(['address', 'from', 'to', 'years_at_address', 'months_at_address'] as const).map((key) => <label key={key} className={`text-xs font-semibold text-cui-muted ${key === 'address' ? 'sm:col-span-2' : ''}`}>
            {key === 'address' ? 'Address' : key === 'from' ? 'Move-in date' : key === 'to' ? 'Move-out date' : key === 'years_at_address' ? 'Years at address' : 'Additional months'}
            <input className={input} type={key === 'address' ? 'text' : key === 'from' || key === 'to' ? 'date' : 'number'} value={row[key] ?? ''}
              min={key.endsWith('_at_address') ? 0 : undefined} max={key === 'months_at_address' ? 11 : key === 'years_at_address' ? 120 : undefined}
              onChange={(event) => updateHistory(index, (driver.previous_addresses ?? []).map((item, current) => current === position ? { ...item, [key]: event.target.value } : item))} />
          </label>)}
          <button type="button" className="text-left text-xs font-semibold text-cui-danger" onClick={() => updateHistory(index, (driver.previous_addresses ?? []).filter((_, current) => current !== position))}>Remove previous address {position + 1}</button>
        </fieldset>)}
        <button type="button" disabled={(driver.previous_addresses?.length ?? 0) >= 10} className="text-xs font-semibold text-cui-primary"
          onClick={() => updateHistory(index, [...driver.previous_addresses ?? [], { address: '', from: '', to: '' }])}>
          Add previous address
        </button>
      </div>
      <button type="button" className="text-left text-xs font-semibold text-cui-danger" onClick={() => onChange(drivers.filter((_, position) => position !== index))}>Remove driver {index + 1}</button>
    </fieldset>)}
    <button type="button" disabled={drivers.length >= 20} className="text-xs font-semibold text-cui-primary" onClick={() => onChange([...drivers, { ...EMPTY_DRIVER, license_state: state,
      address: drivers.length === 0 ? applicantAddress : '', previous_addresses: [] }])}>+ Add driver</button>
  </fieldset>;
}
