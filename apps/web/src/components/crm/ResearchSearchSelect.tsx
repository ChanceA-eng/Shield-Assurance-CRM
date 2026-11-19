'use client';

import { useEffect, useId, useState } from 'react';

interface Option { value: string; label: string }
export default function ResearchSearchSelect({ label, value, options, onChange, disabled, placeholder }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; placeholder: string;
}): JSX.Element {
  const id = useId(), [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const selected = options.find((item) => item.value === value);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = options.filter((item) => terms.every((term) => item.label.toLowerCase().includes(term)));
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  const choose = (next: string): void => { onChange(next); setOpen(false); setQuery(''); setActive(0); };
  return <div className="relative min-w-0">
    <label htmlFor={id} className="block text-sm">{label}</label>
    <div className="mt-1 flex rounded border border-cui-border bg-white">
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
        disabled={disabled} placeholder={placeholder} value={open ? query : selected?.label ?? ''}
        className="min-w-0 flex-1 rounded px-3 py-2 text-sm disabled:bg-gray-100"
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onBlur={() => { setOpen(false); setQuery(''); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); setQuery(''); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((current) => Math.max(0, Math.min(matches.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && open) { event.preventDefault(); if (matches[active]) choose(matches[active].value); }
        }} />
      {value ? <button type="button" disabled={disabled} aria-label={`Clear ${label}`} className="px-2 text-cui-muted" onClick={() => choose('')}>x</button> : null}
      <button type="button" disabled={disabled} aria-label={`Choose ${label}`} className="px-2 text-cui-primary"
        onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen((current) => !current); setQuery(''); setActive(0); }}>v</button>
    </div>
    {open && !disabled ? <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded border border-cui-border bg-white shadow-lg">
      <ul id={`${id}-list`} role="listbox" aria-label={label}>
        {matches.map((item, index) => <li key={item.value} id={`${id}-option-${index}`} role="option" aria-selected={item.value === value}
          className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-blue-50' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item.value)}>{item.label}</li>)}
      </ul>
      {!matches.length ? <p className="px-3 py-2 text-sm text-cui-muted">No matching choices.</p> : null}
    </div> : null}
  </div>;
}
