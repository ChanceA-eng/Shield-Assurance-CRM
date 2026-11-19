'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardBody } from '../ui/Card';
import SectionLayout from './SectionLayout';
import { staffRecords, type StaffRecordKind } from '../../lib/staff-records';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { StaffPolicyInbox, StaffPolicyRequestDialog } from './StaffPolicyRequests';

interface Row {
  id: string;
  full_name?: string;
  account?: { full_name: string };
  account_type?: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
  line_of_business?: string;
  policy_number?: string | null;
  carrier?: string;
  renewal_date?: string;
  canEdit?: boolean;
  canRequest?: boolean;
}

function AccountContactEditor({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(row.full_name ?? '');
  const [email, setEmail] = useState(row.email ?? '');
  const [phone, setPhone] = useState(row.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="staff-account-edit-title" onCancel={(event) => {
    if (saving) event.preventDefault();
  }} onClose={onClose} className="w-full max-w-md rounded-lg border border-cui-border bg-cui-panel p-5 text-cui-text shadow-xl backdrop:bg-black/50">
    <h2 id="staff-account-edit-title" className="mb-4 text-lg font-semibold">Edit account contact</h2>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      if (!name.trim()) { setError('Enter an account name.'); return; }
      const current = { full_name: name.trim(), email: email.trim(), phone: phone.trim() };
      const changes = Object.fromEntries(Object.entries(current).filter(([field, value]) => value !== (row[field as keyof typeof current] ?? '')));
      if (Object.keys(changes).length === 0) { dialog.current?.close(); return; }
      setSaving(true);
      setError('');
      try {
        await workspaceFetch('/api/clients', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, ...changes }),
        });
        dialog.current?.close();
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to save the account.');
      } finally {
        setSaving(false);
      }
    }}>
      <label className="block text-sm font-medium">Name
        <input className="crm-input mt-1 w-full" required maxLength={200} disabled={saving} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm font-medium">Email
        <input className="crm-input mt-1 w-full" type="email" maxLength={254} disabled={saving} value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="block text-sm font-medium">Phone
        <input className="crm-input mt-1 w-full" type="tel" maxLength={50} disabled={saving} value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="crm-button" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="submit" className="crm-button crm-button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save contact'}</button>
      </div>
    </form>
  </dialog>;
}

export default function StaffRecordList({ kind }: { kind: StaffRecordKind }): JSX.Element {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState({ search: '', page: 0 });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ rows: Row[]; more: boolean } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [requesting, setRequesting] = useState<Row | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const { label } = staffRecords[kind];
  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    const params = new URLSearchParams({ kind, q: query.search, page: String(query.page) });
    void workspaceFetch<{ rows: Row[]; more: boolean }>(`/api/staff-records?${params}`)
      .then((value) => { if (active) setResult(value); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : `Unable to load ${label.toLowerCase()}.`); });
    return () => { active = false; };
  }, [kind, label, query, retry]);

  const changePage = (page: number): void => { setResult(null); setQuery({ ...query, page }); };
  const hasActions = result?.rows.some((row) => row.canEdit || row.canRequest);
  return <SectionLayout title={label}>
    {kind === 'policies' ? <StaffPolicyInbox /> : null}
    <Card>
      <CardBody>
        <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault(); setSaved(false); setResult(null); setQuery({ search: input.trim(), page: 0 });
        }}>
          <label className="flex flex-col gap-1 text-sm font-medium">{kind === 'policies' ? 'Account name' : 'Name'}
            <input className="crm-input" value={input} maxLength={100} onChange={(event) => setInput(event.target.value)} />
          </label>
          <button type="submit" className="crm-button crm-button-primary">Search</button>
        </form>
        {saved ? <p role="status" className="mb-3 text-sm text-cui-text">Account contact saved.</p> : null}
        {submitted ? <p role="status" className="mb-3 text-sm text-cui-text">Request sent to the admin inbox.</p> : null}
        {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-cui-danger">
          {error}<button className="crm-button" onClick={() => { setError(''); setRetry(retry + 1); }}>Retry</button>
        </div> : !result ? <p role="status" className="text-sm text-cui-muted">Loading {label.toLowerCase()}...</p>
          : result.rows.length === 0 ? <p className="text-sm text-cui-muted">No matching {label.toLowerCase()}.</p>
          : <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-cui-body"><tr>
                {(kind === 'policies' ? ['Account', 'Policy', 'Carrier', 'Coverage', 'Status', 'Renewal']
                  : kind === 'leads' ? ['Name', 'Email', 'Phone', 'Coverage', 'Status']
                    : ['Name', 'Email', 'Phone', 'Type']).map((column) => <th key={column} scope="col" className="px-3 py-2">{column}</th>)}
                {hasActions ? <th scope="col" className="px-3 py-2">Actions</th> : null}
              </tr></thead>
              <tbody>{result.rows.map((row) => {
                const values = kind === 'policies' ? [row.account?.full_name, row.policy_number, row.carrier, row.line_of_business, row.status, row.renewal_date]
                  : kind === 'leads' ? [row.full_name, row.email, row.phone, row.line_of_business, row.status] : [row.full_name, row.email, row.phone, row.account_type];
                return <tr key={row.id} className="border-b border-cui-border">{values.map((value, index) =>
                  <td key={index} className="px-3 py-2">{value || '-'}</td>)}
                  {hasActions ? <td className="px-3 py-2">{row.canEdit ? <button className="crm-button"
                    aria-label={`Edit contact for ${row.full_name}`} onClick={() => { setSaved(false); setEditing(row); }}>Edit contact</button>
                    : row.canRequest ? <button className="crm-button" onClick={() => { setSubmitted(false); setRequesting(row); }}>Request change</button> : null}</td> : null}
                </tr>;
              })}</tbody>
            </table>
          </div>}
        {result && (query.page > 0 || result.more) ? <nav aria-label={`${label} pages`} className="mt-4 flex items-center gap-2">
          <button className="crm-button" disabled={query.page === 0} onClick={() => changePage(query.page - 1)}>Previous</button>
          <span className="text-sm text-cui-muted">Page {query.page + 1}</span>
          <button className="crm-button" disabled={!result.more || query.page === 10000} onClick={() => changePage(query.page + 1)}>Next</button>
        </nav> : null}
      </CardBody>
    </Card>
    {editing ? <AccountContactEditor row={editing} onClose={() => setEditing(null)}
      onSaved={() => { setSaved(true); setRetry((value) => value + 1); }} /> : null}
    {requesting ? <StaffPolicyRequestDialog id={requesting.id} label={`${requesting.account?.full_name ?? 'Policy'} ${requesting.policy_number ?? ''}`.trim()}
      onClose={() => setRequesting(null)} onSubmitted={() => setSubmitted(true)} /> : null}
  </SectionLayout>;
}
