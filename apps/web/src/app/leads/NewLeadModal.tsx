'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import CommercialScript from './scripts/CommercialScript';
import PersonalScript from './scripts/PersonalScript';
import {
  CARRIERS, COMMERCIAL_COVERAGES, COMMERCIAL_VEHICLE_TYPES, CONSTRUCTION_TYPES, CONTACT_METHODS, CONTACT_TITLES, DRIVER_RELATIONSHIPS,
  ENTITY_TYPES, INDUSTRY_GROUPS, LEAD_SOURCES, MARITAL_STATUSES, OWNERSHIP, PERSONAL_COVERAGES, PRIOR_LIMITS, PROPERTY_USES, ROOF_TYPES,
  UMBRELLA_LIMITS, US_STATES, VEHICLE_USES, phoneDigits,
  type DriverInput, type ExistingRecord, type IntakeKind, type PropertyInput, type VehicleInput,
} from '../../lib/agent-lead-intake';

interface NewLeadModalProps {
  onClose: () => void;
  onCreated: (leadId: string) => void;
}

const EMPTY_CONTACT = { first_name: '', last_name: '', title: '', phone: '', email: '', preferred_contact: '', street: '', city: '', state: 'AZ', zip: '' };
const EMPTY_BUSINESS = {
  legal_name: '', dba: '', entity_type: '', fein: '', years_in_business: '', website: '', industry_group: '', business_type: '',
  naics: '', description: '', employees: '', annual_revenue: '', annual_payroll: '',
};
const EMPTY_VEHICLE: VehicleInput = { year: '', make: '', model: '', vin: '', use: '', ownership: '', vehicle_type: '' };
const PROPERTY_COVERAGES = new Set(['home', 'condo', 'landlord', 'renters']);
const ignoreScript = (): void => undefined;

const input = 'mt-1 w-full rounded border border-cui-border px-2.5 py-1.5 text-sm text-cui-text focus:border-cui-primary focus:outline-none';
const labelCls = 'block text-xs font-semibold text-cui-muted';

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded border border-cui-border/70">
      <div className="flex items-center justify-between border-b border-cui-border/50 bg-cui-light px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-cui-text">{title}</h3>
        {action}
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, type = 'text', required, wide, placeholder, list }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; wide?: boolean; placeholder?: string; list?: string;
}): JSX.Element {
  return (
    <label className={`${labelCls} ${wide ? 'sm:col-span-2' : ''}`}>
      {label}{required ? <span className="text-cui-danger"> *</span> : null}
      <input type={type} className={input} value={value} required={required} placeholder={placeholder} list={list} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, options, required, placeholder = 'Select…' }: {
  label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<string | { value: string; label: string }>; required?: boolean; placeholder?: string;
}): JSX.Element {
  return (
    <label className={labelCls}>
      {label}{required ? <span className="text-cui-danger"> *</span> : null}
      <select className={input} value={value} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => typeof option === 'string'
          ? <option key={option} value={option}>{option}</option>
          : <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CoveragePicker({ options, selected, onToggle }: { options: ReadonlyArray<{ value: string; label: string }>; selected: string[]; onToggle: (value: string) => void }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2 sm:col-span-2" role="group" aria-label="Coverages">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button key={option.value} type="button" aria-pressed={active} onClick={() => onToggle(option.value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${active ? 'border-cui-primary bg-cui-primary text-white' : 'border-cui-border bg-white text-cui-muted hover:border-cui-primary'}`}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }): JSX.Element {
  return <button type="button" onClick={onClick} aria-label={label} className="text-xs font-semibold text-cui-danger hover:underline">Remove</button>;
}

function daysUntil(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

export default function NewLeadModal({ onClose, onCreated }: NewLeadModalProps): JSX.Element {
  const [kind, setKind] = useState<IntakeKind>('personal');
  const [source, setSource] = useState('Phone Call');
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [personal, setPersonal] = useState({ dob: '', marital_status: '', occupation: '', prior_limits: '', umbrella_limit: '' });
  const [business, setBusiness] = useState(EMPTY_BUSINESS);
  const [coverages, setCoverages] = useState<string[]>([]);
  const [current, setCurrent] = useState({ carrier: '', expiration: '', premium: '' });
  const [drivers, setDrivers] = useState<DriverInput[]>([]);
  const [vehicles, setVehicles] = useState<VehicleInput[]>([]);
  const [properties, setProperties] = useState<PropertyInput[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [showScript, setShowScript] = useState(false);
  const [matches, setMatches] = useState<ExistingRecord[]>([]);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();
  const homeAddress = [contact.street, [contact.city, [contact.state, contact.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const group = business.industry_group ? INDUSTRY_GROUPS[business.industry_group] : undefined;
  const renewalDays = daysUntil(current.expiration);

  const setContactField = (field: keyof typeof EMPTY_CONTACT, value: string): void => setContact((prev) => ({ ...prev, [field]: value }));
  const setBusinessField = (field: keyof typeof EMPTY_BUSINESS, value: string): void => setBusiness((prev) => ({ ...prev, [field]: value }));

  // Smart prefill: look for an existing lead/account as soon as a usable email or phone is entered.
  useEffect(() => {
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) ? contact.email.trim() : '';
    const phone = phoneDigits(contact.phone).length === 10 ? contact.phone : '';
    if (!email && !phone) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ email, phone });
      void fetch(`/api/leads/intake?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        .then(async (res) => (res.ok ? ((await res.json()) as { matches: ExistingRecord[] }).matches : []))
        .then((found) => setMatches(found))
        .catch(() => undefined);
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [contact.email, contact.phone]);

  const applyPersonalDefaults = useCallback((selected: string[]): void => {
    if (selected.includes('auto')) {
      setDrivers((prev) => (prev.length ? prev : [{ name: fullName, dob: personal.dob, relationship: 'Self', license_state: contact.state }]));
      setVehicles((prev) => (prev.length ? prev : [{ ...EMPTY_VEHICLE }]));
    }
    if (selected.some((value) => PROPERTY_COVERAGES.has(value))) {
      setProperties((prev) => (prev.length ? prev : [{
        address: homeAddress, use: selected.includes('landlord') ? 'Rental' : 'Primary home', year_built: '', roof: '', construction: '', has_pool: '', dog_breed: '',
      }]));
    }
  }, [contact.state, fullName, homeAddress, personal.dob]);

  function toggleCoverage(value: string): void {
    const next = coverages.includes(value) ? coverages.filter((item) => item !== value) : [...coverages, value];
    setCoverages(next);
    if (kind === 'personal') applyPersonalDefaults(next);
    if (kind === 'commercial' && value === 'commercial_auto' && next.includes(value)) setVehicles((prev) => (prev.length ? prev : [{ ...EMPTY_VEHICLE }]));
  }

  function chooseKind(next: IntakeKind): void {
    if (next === kind) return;
    setKind(next);
    setCoverages([]);
    setVehicles([]);
    setDrivers([]);
    setProperties([]);
    setAnswers({});
  }

  function chooseIndustry(value: string): void {
    const nextGroup = INDUSTRY_GROUPS[value];
    setBusiness((prev) => ({ ...prev, industry_group: value, business_type: '', naics: '' }));
    setAnswers({});
    if (nextGroup && coverages.length === 0) {
      setCoverages([...nextGroup.suggestedCoverages]);
      if (nextGroup.suggestedCoverages.includes('commercial_auto')) setVehicles((prev) => (prev.length ? prev : [{ ...EMPTY_VEHICLE }]));
    }
  }

  function chooseBusinessType(value: string): void {
    const match = group?.businessTypes.find((type) => type.label.toLowerCase() === value.trim().toLowerCase());
    setBusiness((prev) => ({ ...prev, business_type: value, naics: match ? match.naics : prev.naics }));
  }

  function prefillFrom(record: ExistingRecord): void {
    const [first, ...rest] = record.full_name.trim().split(/\s+/);
    setContact((prev) => ({
      ...prev,
      first_name: prev.first_name || first || '',
      last_name: prev.last_name || rest.join(' '),
      email: prev.email || record.email || '',
      phone: prev.phone || record.phone || '',
      street: prev.street || record.address || '',
      state: record.state && (US_STATES as readonly string[]).includes(record.state) ? record.state : prev.state,
      zip: prev.zip || record.zip || '',
    }));
    if (record.business) setBusiness((prev) => ({ ...prev, legal_name: prev.legal_name || record.business || '' }));
  }

  function updateRow<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>): void {
    setter((prev) => prev.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  const payload = useMemo(() => {
    const base = { kind, source, contact, coverages, current, vehicles, notes };
    return kind === 'personal'
      ? { ...base, ...personal, drivers, properties }
      : { ...base, business, industry_answers: Object.fromEntries(Object.entries(answers).filter(([, value]) => value)) };
  }, [answers, business, contact, coverages, current, drivers, kind, notes, personal, properties, source, vehicles]);

  async function submit(allowDuplicate: boolean): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/leads/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intake: payload, allow_duplicate: allowDuplicate }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; matches?: ExistingRecord[] };
      if (res.status === 409 && body.matches) {
        setMatches(body.matches);
        setDuplicateBlocked(true);
        return;
      }
      if (!res.ok || !body.id) {
        setError(body.message ?? 'The lead could not be created.');
        return;
      }
      onCreated(body.id);
    } catch {
      setError('The lead could not be created. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
      <div role="dialog" aria-modal="true" aria-labelledby="new-lead-title" className="w-full max-w-6xl rounded border border-cui-border bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cui-border/60 px-5 py-3">
          <div>
            <h2 id="new-lead-title" className="text-lg font-bold text-cui-text">New Lead</h2>
            <p className="text-xs text-cui-muted">Capture what you learn on the call. Vehicles, drivers and properties become profile assets automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-cui-border p-0.5" role="tablist" aria-label="Line of business">
              {(['personal', 'commercial'] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => chooseKind(value)}
                  className={`rounded px-3 py-1.5 text-sm font-semibold ${kind === value ? 'bg-cui-primary text-white' : 'text-cui-muted hover:text-cui-text'}`}>
                  {value === 'personal' ? 'Personal lines' : 'Commercial lines'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowScript((value) => !value)} className="rounded border border-cui-border px-3 py-1.5 text-xs font-semibold text-cui-muted hover:bg-cui-light">
              {showScript ? 'Hide call script' : 'Call script'}
            </button>
            <button type="button" onClick={onClose} className="rounded bg-cui-light px-3 py-1.5 text-xs font-semibold text-cui-muted hover:bg-cui-border">Close</button>
          </div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void submit(false); }} className={`grid gap-0 ${showScript ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
          <div className="space-y-4 p-5">
            {matches.length ? (
              <div className={`rounded border px-3 py-2 text-sm ${duplicateBlocked ? 'border-cui-danger/50 bg-rose-50' : 'border-amber-300 bg-amber-50'}`} role="status">
                <p className="font-semibold text-cui-text">
                  {duplicateBlocked ? 'This person is already in the CRM. Open the existing record, or create a separate lead anyway.' : 'Possible existing record — prefill from it or open it instead of creating a duplicate.'}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {matches.map((record) => (
                    <li key={`${record.type}-${record.id}`} className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-bold uppercase text-cui-muted">{record.type === 'account' ? 'Account' : 'Lead'}</span>
                      <span className="font-semibold">{record.full_name}</span>
                      {record.business ? <span className="text-cui-muted">· {record.business}</span> : null}
                      <span className="text-xs text-cui-muted">matched {record.match.join(' + ')}{record.status ? ` · ${record.status}` : ''}</span>
                      <button type="button" onClick={() => prefillFrom(record)} className="text-xs font-semibold text-cui-primary hover:underline">Use details</button>
                      <Link href={(record.type === 'account' ? `/clients/${record.id}` : `/leads?lead=${record.id}`) as Route} className="text-xs font-semibold text-cui-primary hover:underline">Open</Link>
                    </li>
                  ))}
                </ul>
                {duplicateBlocked ? (
                  <button type="button" disabled={isSaving} onClick={() => void submit(true)} className="mt-2 rounded border border-cui-danger px-3 py-1 text-xs font-semibold text-cui-danger hover:bg-white disabled:opacity-60">
                    Create a separate lead anyway
                  </button>
                ) : null}
              </div>
            ) : null}

            {kind === 'commercial' ? (
              <Section title="Business">
                <TextField label="Business legal name" value={business.legal_name} onChange={(value) => setBusinessField('legal_name', value)} required />
                <TextField label="DBA (if different)" value={business.dba} onChange={(value) => setBusinessField('dba', value)} />
                <SelectField label="Industry" value={business.industry_group} onChange={chooseIndustry} required
                  options={Object.entries(INDUSTRY_GROUPS).map(([value, item]) => ({ value, label: item.label }))} />
                <TextField label="Business type" value={business.business_type} onChange={chooseBusinessType} required list="business-types"
                  placeholder={group?.businessTypes[0]?.label ?? 'e.g. Roofing contractor'} />
                <datalist id="business-types">
                  {group?.businessTypes.map((type) => <option key={type.label} value={type.label} />)}
                </datalist>
                <TextField label="What the business does" value={business.description} onChange={(value) => setBusinessField('description', value)} wide />
                <TextField label="NAICS (auto-filled)" value={business.naics} onChange={(value) => setBusinessField('naics', value.replace(/\D/g, '').slice(0, 6))} />
                <SelectField label="Entity type" value={business.entity_type} onChange={(value) => setBusinessField('entity_type', value)} options={ENTITY_TYPES} />
                <TextField label="FEIN" value={business.fein} placeholder="12-3456789" onChange={(value) => setBusinessField('fein', value.replace(/[^\d-]/g, '').slice(0, 10))} />
                <TextField label="Years in business" value={business.years_in_business} type="number" onChange={(value) => setBusinessField('years_in_business', value)} />
                <TextField label="Employees" value={business.employees} type="number" onChange={(value) => setBusinessField('employees', value)} />
                <TextField label="Annual revenue ($)" value={business.annual_revenue} onChange={(value) => setBusinessField('annual_revenue', value)} />
                <TextField label="Annual payroll ($)" value={business.annual_payroll} onChange={(value) => setBusinessField('annual_payroll', value)} />
                <TextField label="Website" value={business.website} onChange={(value) => setBusinessField('website', value)} />
              </Section>
            ) : null}

            <Section title={kind === 'commercial' ? 'Primary contact' : 'Applicant'}>
              <TextField label="First name" value={contact.first_name} onChange={(value) => setContactField('first_name', value)} required />
              <TextField label="Last name" value={contact.last_name} onChange={(value) => setContactField('last_name', value)} required />
              {kind === 'commercial' ? (
                <SelectField label="Title" value={contact.title} onChange={(value) => setContactField('title', value)} options={CONTACT_TITLES} />
              ) : (
                <>
                  <TextField label="Date of birth" type="date" value={personal.dob} onChange={(value) => setPersonal((prev) => ({ ...prev, dob: value }))} />
                  <SelectField label="Marital status" value={personal.marital_status} onChange={(value) => setPersonal((prev) => ({ ...prev, marital_status: value }))} options={MARITAL_STATUSES} />
                  <TextField label="Occupation" value={personal.occupation} onChange={(value) => setPersonal((prev) => ({ ...prev, occupation: value }))} />
                </>
              )}
              <TextField label="Phone" type="tel" value={contact.phone} onChange={(value) => setContactField('phone', value)} required />
              <TextField label="Email" type="email" value={contact.email} onChange={(value) => setContactField('email', value)} />
              <SelectField label="Preferred contact" value={contact.preferred_contact} onChange={(value) => setContactField('preferred_contact', value)} options={CONTACT_METHODS} />
              <SelectField label="Lead source" value={source} onChange={setSource} options={LEAD_SOURCES} required />
              <TextField label={kind === 'commercial' ? 'Business street address' : 'Home street address'} value={contact.street} onChange={(value) => setContactField('street', value)} wide />
              <TextField label="City" value={contact.city} onChange={(value) => setContactField('city', value)} />
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="State" value={contact.state} onChange={(value) => setContactField('state', value)} options={US_STATES} />
                <TextField label="ZIP" value={contact.zip} onChange={(value) => setContactField('zip', value.replace(/[^\d-]/g, '').slice(0, 10))} />
              </div>
            </Section>

            <Section title="Coverage & current insurance">
              <p className="text-xs text-cui-muted sm:col-span-2">
                {kind === 'commercial' && group ? `Suggested for ${group.label.toLowerCase()} are pre-selected — adjust to what the prospect asked for.` : 'Select everything the prospect asked about.'}
              </p>
              <CoveragePicker options={kind === 'personal' ? PERSONAL_COVERAGES : COMMERCIAL_COVERAGES} selected={coverages} onToggle={toggleCoverage} />
              <SelectField label="Current carrier" value={current.carrier} onChange={(value) => setCurrent((prev) => ({ ...prev, carrier: value }))} options={CARRIERS} />
              <label className={labelCls}>
                Current policy expires (X-date)
                <input type="date" className={input} value={current.expiration} onChange={(event) => setCurrent((prev) => ({ ...prev, expiration: event.target.value }))} />
                {renewalDays !== null ? (
                  <span className={`mt-1 block text-xs ${renewalDays >= 0 && renewalDays <= 45 ? 'font-semibold text-cui-danger' : 'text-cui-muted'}`}>
                    {renewalDays < 0 ? 'Already expired — possible lapse.' : `Renews in ${renewalDays} day${renewalDays === 1 ? '' : 's'}.`}
                  </span>
                ) : null}
              </label>
              <TextField label="Current premium ($/yr)" value={current.premium} onChange={(value) => setCurrent((prev) => ({ ...prev, premium: value }))} />
              {kind === 'personal' && coverages.includes('auto') ? (
                <SelectField label="Current auto liability limits" value={personal.prior_limits} onChange={(value) => setPersonal((prev) => ({ ...prev, prior_limits: value }))} options={PRIOR_LIMITS} />
              ) : null}
              {kind === 'personal' && coverages.includes('umbrella') ? (
                <SelectField label="Umbrella limit wanted" value={personal.umbrella_limit} onChange={(value) => setPersonal((prev) => ({ ...prev, umbrella_limit: value }))} options={UMBRELLA_LIMITS} />
              ) : null}
            </Section>

            {kind === 'commercial' && group && group.questions.length ? (
              <Section title={`${group.label} questions`}>
                {group.questions.map((question) => question.type === 'yesno' || question.type === 'select' ? (
                  <SelectField key={question.key} label={question.label} value={answers[question.key] ?? ''}
                    onChange={(value) => setAnswers((prev) => ({ ...prev, [question.key]: value }))}
                    options={question.type === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : question.options ?? []} />
                ) : (
                  <TextField key={question.key} label={question.label} type={question.type === 'number' ? 'number' : 'text'} value={answers[question.key] ?? ''}
                    onChange={(value) => setAnswers((prev) => ({ ...prev, [question.key]: value }))} />
                ))}
              </Section>
            ) : null}

            {kind === 'personal' && (coverages.includes('auto') || drivers.length > 0) ? (
              <Section title={`Drivers (${drivers.length})`} action={
                <button type="button" onClick={() => setDrivers((prev) => [...prev, { name: '', dob: '', relationship: '', license_state: contact.state }])} className="text-xs font-semibold text-cui-primary hover:underline">+ Add driver</button>
              }>
                {drivers.map((driver, index) => (
                  <div key={index} className="grid gap-2 rounded border border-cui-border/50 p-2 sm:col-span-2 sm:grid-cols-4">
                    <TextField label={`Driver ${index + 1} name`} value={driver.name} onChange={(value) => updateRow(setDrivers, index, { name: value })} required />
                    <TextField label="Date of birth" type="date" value={driver.dob} onChange={(value) => updateRow(setDrivers, index, { dob: value })} />
                    <SelectField label="Relationship" value={driver.relationship} onChange={(value) => updateRow(setDrivers, index, { relationship: value })} options={DRIVER_RELATIONSHIPS} />
                    <div className="flex items-end gap-2">
                      <SelectField label="License state" value={driver.license_state} onChange={(value) => updateRow(setDrivers, index, { license_state: value })} options={US_STATES} />
                      <RemoveButton label={`Remove driver ${index + 1}`} onClick={() => setDrivers((prev) => prev.filter((_, position) => position !== index))} />
                    </div>
                  </div>
                ))}
              </Section>
            ) : null}

            {coverages.includes('auto') || coverages.includes('commercial_auto') || vehicles.length > 0 ? (
              <Section title={`Vehicles (${vehicles.length})`} action={
                <button type="button" onClick={() => setVehicles((prev) => [...prev, { ...EMPTY_VEHICLE }])} className="text-xs font-semibold text-cui-primary hover:underline">+ Add vehicle</button>
              }>
                <p className="text-xs text-cui-muted sm:col-span-2">Garaged at the {kind === 'commercial' ? 'business' : 'home'} address unless you change it on the asset later. Leave VIN empty if unknown.</p>
                {vehicles.map((vehicle, index) => (
                  <div key={index} className="grid gap-2 rounded border border-cui-border/50 p-2 sm:col-span-2 sm:grid-cols-4">
                    <TextField label={`Vehicle ${index + 1} year`} value={vehicle.year} onChange={(value) => updateRow(setVehicles, index, { year: value.replace(/\D/g, '').slice(0, 4) })} />
                    <TextField label="Make" value={vehicle.make} onChange={(value) => updateRow(setVehicles, index, { make: value })} />
                    <TextField label="Model" value={vehicle.model} onChange={(value) => updateRow(setVehicles, index, { model: value })} />
                    <TextField label="VIN" value={vehicle.vin} onChange={(value) => updateRow(setVehicles, index, { vin: value.toUpperCase().slice(0, 17) })} />
                    {kind === 'commercial' ? (
                      <SelectField label="Type" value={vehicle.vehicle_type} onChange={(value) => updateRow(setVehicles, index, { vehicle_type: value })} options={COMMERCIAL_VEHICLE_TYPES} />
                    ) : (
                      <SelectField label="Use" value={vehicle.use} onChange={(value) => updateRow(setVehicles, index, { use: value })} options={VEHICLE_USES} />
                    )}
                    <SelectField label="Ownership" value={vehicle.ownership} onChange={(value) => updateRow(setVehicles, index, { ownership: value })} options={OWNERSHIP} />
                    <div className="flex items-end">
                      <RemoveButton label={`Remove vehicle ${index + 1}`} onClick={() => setVehicles((prev) => prev.filter((_, position) => position !== index))} />
                    </div>
                  </div>
                ))}
              </Section>
            ) : null}

            {kind === 'personal' && (coverages.some((value) => PROPERTY_COVERAGES.has(value)) || properties.length > 0) ? (
              <Section title={`Properties (${properties.length})`} action={
                <button type="button" onClick={() => setProperties((prev) => [...prev, { address: '', use: '', year_built: '', roof: '', construction: '', has_pool: '', dog_breed: '' }])} className="text-xs font-semibold text-cui-primary hover:underline">+ Add property</button>
              }>
                {properties.map((property, index) => (
                  <div key={index} className="grid gap-2 rounded border border-cui-border/50 p-2 sm:col-span-2 sm:grid-cols-4">
                    <div className="sm:col-span-3">
                      <TextField label={`Property ${index + 1} address`} value={property.address} onChange={(value) => updateRow(setProperties, index, { address: value })} required />
                    </div>
                    <div className="flex items-end gap-2">
                      {homeAddress && property.address !== homeAddress ? (
                        <button type="button" onClick={() => updateRow(setProperties, index, { address: homeAddress })} className="text-xs font-semibold text-cui-primary hover:underline">Use home address</button>
                      ) : null}
                      <RemoveButton label={`Remove property ${index + 1}`} onClick={() => setProperties((prev) => prev.filter((_, position) => position !== index))} />
                    </div>
                    <SelectField label="Use" value={property.use} onChange={(value) => updateRow(setProperties, index, { use: value })} options={PROPERTY_USES} />
                    <TextField label="Year built" value={property.year_built} onChange={(value) => updateRow(setProperties, index, { year_built: value.replace(/\D/g, '').slice(0, 4) })} />
                    <SelectField label="Roof" value={property.roof} onChange={(value) => updateRow(setProperties, index, { roof: value })} options={ROOF_TYPES} />
                    <SelectField label="Construction" value={property.construction} onChange={(value) => updateRow(setProperties, index, { construction: value })} options={CONSTRUCTION_TYPES} />
                    <SelectField label="Pool" value={property.has_pool} onChange={(value) => updateRow(setProperties, index, { has_pool: value })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                    <TextField label="Dog breed (if any)" value={property.dog_breed} onChange={(value) => updateRow(setProperties, index, { dog_breed: value })} />
                  </div>
                ))}
              </Section>
            ) : null}

            <Section title="Call notes">
              <label className={`${labelCls} sm:col-span-2`}>
                Saved as a call note on the lead
                <textarea rows={3} className={input} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did they ask for? Anything urgent?" />
              </label>
            </Section>

            {error ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded bg-cui-light px-4 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border">Cancel</button>
              <button type="submit" disabled={isSaving} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white hover:bg-cui-primary/90 disabled:opacity-60">
                {isSaving ? 'Creating lead…' : `Create ${kind} lead`}
              </button>
            </div>
          </div>

          {showScript ? (
            <aside className="border-t border-cui-border/60 bg-cui-light/50 p-5 lg:border-l lg:border-t-0">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-cui-muted">Live call script</h3>
              {kind === 'commercial' ? <CommercialScript onChange={ignoreScript} /> : <PersonalScript onChange={ignoreScript} />}
            </aside>
          ) : null}
        </form>
      </div>
    </div>
  );
}
