'use client';

import React from 'react';
import { PlacementDocumentPicker } from './PlacementDocuments';

export interface CoverageEvidenceInput {
  confirmed_on: string;
  reference: string;
  file_id: string;
  attested: boolean;
}

export default function PolicyCoverageEvidence({ accountId, value, onChange, onBusyChange }: {
  accountId: string;
  value: CoverageEvidenceInput;
  onChange: (value: CoverageEvidenceInput) => void;
  onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  return <fieldset className="space-y-2 rounded border border-cui-border p-3">
    <legend className="px-1 text-sm font-semibold">Evidence of coverage</legend>
    <p className="text-xs text-cui-muted">Select an issued policy, declarations page or binder, or enter a confirmation reference.</p>
    <label className="block text-xs">Evidence date
      <input required aria-label="Evidence date" type="date" value={value.confirmed_on}
        onChange={(event) => onChange({ ...value, confirmed_on: event.target.value, attested: false })}
        className="block w-full rounded border border-cui-border px-2 py-2" />
    </label>
    {accountId ? <PlacementDocumentPicker key={accountId} accountId={accountId}
      value={value.file_id} onBusyChange={onBusyChange}
      onChange={(id) => onChange({ ...value, file_id: id, attested: false })} /> : null}
    <label className="block text-xs">Carrier evidence reference {value.file_id ? '(optional)' : '(if no document is selected)'}
      <input aria-label="Carrier evidence reference" required={!value.file_id} maxLength={500} value={value.reference}
        placeholder="For example: carrier binder email dated November 6"
        onChange={(event) => onChange({ ...value, reference: event.target.value, attested: false })}
        className="block w-full rounded border border-cui-border px-2 py-2" />
    </label>
    <label className="flex items-start gap-2 text-xs">
      <input required type="checkbox" checked={value.attested}
        onChange={(event) => onChange({ ...value, attested: event.target.checked })} />
      I reviewed this evidence and confirmed it applies to this exact policy term.
    </label>
  </fieldset>;
}
