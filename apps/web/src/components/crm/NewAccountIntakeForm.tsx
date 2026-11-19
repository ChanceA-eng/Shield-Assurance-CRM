'use client';

import React, { useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useIntakeDocuments } from './AccountPolicyIntake';
import { saveReviewedIntakeDocuments } from '../../lib/account-document-client';
import ApplicantDetailsFields from './ApplicantDetailsFields';
import DriverIntakeFields from './DriverIntakeFields';
import { EMPTY_APPLICANT, type ApplicantDetails, type IntakeDriver } from '../../lib/applicant-details';
import { preventImplicitIntakeSubmit } from '../../lib/intake-keyboard';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

export interface CreatedIntakeAccount {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export default function NewAccountIntakeForm({ onCreated, onCancel }: {
  onCreated: (account: CreatedIntakeAccount) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const { fields, documents, setSaving, uploadedDocuments } = useIntakeDocuments();
  const [values, setValues] = useState({
    full_name: '', phone: '', email: '', address: '', source: '',
    email_consent: false, sms_consent: false, preferred_channel: 'email',
  });
  const [busy, setBusy] = useState(false);
  const [applicant, setApplicant] = useState<ApplicantDetails>({ ...EMPTY_APPLICANT, previous_addresses: [] });
  const [drivers, setDrivers] = useState<IntakeDriver[]>([]);
  const [error, setError] = useState('');
  const [savedAccount, setSavedAccount] = useState<CreatedIntakeAccount | null>(null);
  const snapshot = JSON.stringify({ values, applicant, drivers });
  const initial = useRef(snapshot);
  const { markSaved, confirmDiscard } = useUnsavedChanges((!savedAccount && (snapshot !== initial.current || documents.length > 0)) || Boolean(savedAccount && error));
  useEffect(() => () => setSaving(false), [setSaving]);
  useEffect(() => {
    if (savedAccount) return;
    setValues((previous) => ({ ...previous,
      full_name: fields.full_name ?? previous.full_name, address: fields.address ?? previous.address,
      email: fields.email ?? previous.email, phone: fields.phone ?? previous.phone,
      source: Object.keys(fields).length ? 'Reviewed policy document' : previous.source,
    }));
  }, [fields, savedAccount]);
  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setSaving(true); setError('');
    try {
      const account = savedAccount ?? await workspaceFetch<CreatedIntakeAccount>('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, intake_details: { applicant, drivers } }),
      });
      setSavedAccount(account);
      try { await saveReviewedIntakeDocuments(account.id, documents, fields, uploadedDocuments); }
      catch (failure) { throw new Error(`Account saved. Document review needs retry: ${failure instanceof Error ? failure.message : 'Upload failed.'}`); }
      markSaved();
      await onCreated(account);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Account could not be saved. Check Accounts before retrying.');
    } finally { setBusy(false); setSaving(false); }
  };
  const input = 'crm-input';
  return <form onKeyDown={preventImplicitIntakeSubmit} onSubmit={(event) => event.preventDefault()} className="space-y-2">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    <fieldset disabled={busy} className="space-y-2">
      {savedAccount ? <p role="status" className="text-xs text-cui-muted">Account saved. Retry document uploads to continue.</p> : null}
      {(['full_name', 'phone', 'email', 'address', 'source'] as const).map((field) => {
        const label = { full_name: 'Full Name', phone: 'Phone', email: 'Email', address: 'Address', source: 'Source' }[field];
        return <label key={field} className="block text-xs font-semibold text-cui-muted">{label}
          <input disabled={Boolean(savedAccount)} required={field === 'full_name' || field === 'source'} type={field === 'email' ? 'email' : 'text'}
            placeholder={label} value={values[field]} className={input}
            onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))} />
        </label>;
      })}
      <fieldset disabled={Boolean(savedAccount)} className="space-y-3 rounded border border-cui-border p-3">
        <legend className="text-sm font-semibold">Additional applicant information (optional)</legend>
        <ApplicantDetailsFields value={applicant} onChange={setApplicant} />
        <DriverIntakeFields drivers={drivers} onChange={setDrivers} applicantAddress={values.address} />
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-cui-muted">
        <input type="checkbox" checked={values.email_consent}
          onChange={(event) => setValues((previous) => ({ ...previous, email_consent: event.target.checked }))} />
        Client permission to receive insurance emails is recorded.
      </label>
      <label className="flex items-start gap-2 text-sm text-cui-muted">
        <input type="checkbox" checked={values.sms_consent}
          onChange={(event) => setValues((previous) => ({ ...previous, sms_consent: event.target.checked }))} />
        Client permission to receive insurance texts is recorded.
      </label>
      <label className="block text-xs font-semibold text-cui-muted">Preferred contact method
        <select value={values.preferred_channel} className={input}
          onChange={(event) => setValues((previous) => ({ ...previous, preferred_channel: event.target.value }))}>
          <option value="email">Email</option><option value="sms">SMS</option><option value="both">Both</option>
        </select>
      </label>
      <button type="button" onClick={(event) => { if (event.currentTarget.form?.reportValidity()) void save(); }}
        className="w-full rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? 'Saving Account...' : 'Save Account'}
      </button>
      <button type="button" onClick={() => { if (confirmDiscard()) onCancel(); }} className="w-full rounded bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">Cancel</button>
    </fieldset>
  </form>;
}
