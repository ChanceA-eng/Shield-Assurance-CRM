'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssetDetails } from '@crm/shared';
import type { VehicleOption } from '../../lib/vehicle-catalog';
import { workspaceFetch } from '../../lib/workspace-fetch';

export default function VehicleDetailsFields({ value, onChange, disabled = false }: {
  value: AssetDetails; onChange: (details: AssetDetails) => void; disabled?: boolean;
}): JSX.Element {
  const [manual, setManual] = useState(Boolean(value.make || value.model));
  const [type, setType] = useState('car'), [makes, setMakes] = useState<VehicleOption[]>([]), [models, setModels] = useState<VehicleOption[]>([]);
  const [loadingMakes, setLoadingMakes] = useState(false), [loadingModels, setLoadingModels] = useState(false);
  const [decoding, setDecoding] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const decodeVersion = useRef(0);
  const make = makes.find((row) => row.name === value.make)?.id;
  useEffect(() => {
    if (manual) { setLoadingMakes(false); return; }
    let active = true;
    setLoadingMakes(true); setError('');
    void workspaceFetch<{ options: VehicleOption[] }>(`/api/vehicles?type=${type}`)
      .then((data) => { if (active) setMakes(data.options); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Vehicle makes could not be loaded.'); })
      .finally(() => { if (active) setLoadingMakes(false); });
    return () => { active = false; };
  }, [type, manual, catalogRevision]);
  useEffect(() => {
    setModels([]);
    if (manual || !make || !value.year) { setLoadingModels(false); return; }
    let active = true;
    setLoadingModels(true); setError('');
    void workspaceFetch<{ options: VehicleOption[] }>(`/api/vehicles?type=${type}&year=${value.year}&make=${make}`)
      .then((data) => { if (active) { setModels(data.options); if (!data.options.length) setError('No models were found for this year and make. Choose manual vehicle entry.'); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Vehicle models could not be loaded.'); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [type, manual, make, value.year, catalogRevision]);
  useEffect(() => () => { decodeVersion.current++; }, []);
  const input = 'crm-input mt-1';
  const years = Array.from({ length: new Date().getFullYear() - 1898 }, (_, i) => String(new Date().getFullYear() + 1 - i));
  const decodeVin = (): void => {
    if (!value.vin || decoding || disabled) return;
    const version = ++decodeVersion.current;
    setDecoding(true); setError(''); setNotice('');
    void workspaceFetch<{ details: AssetDetails }>(`/api/vehicles?vin=${encodeURIComponent(value.vin)}`)
      .then((result) => { if (version === decodeVersion.current) { onChange({ ...value, ...result.details }); setManual(true); setNotice('Vehicle decoded. Review the details before saving.'); } })
      .catch((failure: unknown) => { if (version === decodeVersion.current) setError(failure instanceof Error ? failure.message : 'VIN could not be decoded.'); })
      .finally(() => { if (version === decodeVersion.current) setDecoding(false); });
  };
  return <fieldset disabled={disabled || decoding} className="space-y-3 sm:col-span-2">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-cui-muted">VIN<input maxLength={17} value={value.vin ?? ''} className={input}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); decodeVin(); } }}
        onChange={(event) => { decodeVersion.current++; setNotice(''); onChange({ ...value, vin: event.target.value.toUpperCase() }); }} /></label>
      <div className="flex items-end"><button type="button" disabled={!value.vin || decoding} className="rounded border border-cui-primary px-3 py-2 text-xs font-semibold text-cui-primary"
        onClick={decodeVin}>{decoding ? 'Decoding...' : 'Decode VIN'}</button></div>
      <label className="text-xs font-semibold text-cui-muted">Vehicle category<select className={input} value={type}
        onChange={(event) => { setType(event.target.value); setMakes([]); setModels([]); onChange({ ...value, make: '', model: '' }); }}>
        <option value="car">Car</option><option value="mpv">SUV / minivan</option><option value="truck">Pickup / commercial truck</option><option value="motorcycle">Motorcycle</option><option value="bus">Bus</option><option value="trailer">Trailer</option>
      </select></label>
      <label className="text-xs font-semibold text-cui-muted">Year<select className={input} value={value.year ?? ''}
        onChange={(event) => onChange({ ...value, year: event.target.value, ...(manual ? {} : { model: '' }) })}>
        <option value="">Choose year</option>{value.year && !years.includes(value.year) ? <option>{value.year}</option> : null}
        {years.map((year) => <option key={year}>{year}</option>)}
      </select></label>
      {(['make', 'model'] as const).map((field) => <label key={field} className="text-xs font-semibold text-cui-muted">{field === 'make' ? 'Make' : 'Model'}
        {manual ? <input className={input} maxLength={200} value={value[field] ?? ''} onChange={(event) => onChange({ ...value, [field]: event.target.value })} />
          : <select className={input} value={value[field] ?? ''} disabled={(field === 'make' ? loadingMakes : loadingModels) || (field === 'model' && (!make || !value.year))}
            onChange={(event) => onChange({ ...value, [field]: event.target.value, ...(field === 'make' ? { model: '' } : {}) })}>
            <option value="">{(field === 'make' ? loadingMakes : loadingModels) ? 'Loading...' : `Choose ${field}`}</option>
            {(field === 'make' ? makes : models).map((row) => <option key={row.id} value={row.name}>{row.name}</option>)}
          </select>}
      </label>)}
    </div>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={manual} onChange={(event) => { setManual(event.target.checked); setError(''); }} />Manual vehicle entry</label>
    {error ? <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-xs text-cui-danger">{error}</p>
      {!manual && !decoding ? <button type="button" className="text-xs font-semibold text-cui-primary" onClick={() => setCatalogRevision((revision) => revision + 1)}>Retry vehicle choices</button> : null}
    </div> : null}
    {notice ? <p role="status" className="text-xs text-cui-success">{notice}</p> : null}
  </fieldset>;
}
