'use client';

import { useEffect, useRef, useState } from 'react';
import { usePolicyAdmin, useStaffWorkspace } from '../../context/StaffWorkspaceContext';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody } from '../ui/Card';

const endpoint = '/api/staff-policy-requests';
const priorityLabels: Record<number, string> = { 1: 'Routine', 2: 'High', 3: 'Urgent' };

export function StaffPolicyRequestDialog({ id, label, onClose, onSubmitted }: {
  id: string; label: string; onClose: () => void; onSubmitted: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}
    aria-labelledby="policy-request-title" className="w-full max-w-md rounded-lg border border-cui-border bg-cui-panel p-5 text-cui-text shadow-xl backdrop:bg-black/50">
    <h2 id="policy-request-title" className="text-lg font-semibold">Request a policy change</h2>
    <p className="mb-4 text-sm text-cui-muted">{label}. This sends a request to an admin; it does not change coverage.</p>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = new FormData(event.currentTarget);
      setBusy(true);
      setError('');
      try {
        await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policy_id: id, priority: Number(form.get('priority')), description: form.get('description') }) });
        dialog.current?.close();
        onSubmitted();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The request could not be sent.');
      } finally { setBusy(false); }
    }}>
      <label className="block text-sm font-medium">Urgency
        <select name="priority" className="crm-input mt-1 w-full" disabled={busy}>
          <option value="1">Routine</option><option value="2">High</option><option value="3">Urgent</option>
        </select>
      </label>
      <label className="block text-sm font-medium">Requested change
        <textarea name="description" rows={5} maxLength={4000} required disabled={busy} className="crm-input mt-1 w-full" />
      </label>
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="crm-button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        <button className="crm-button crm-button-primary" disabled={busy}>{busy ? 'Sending...' : 'Send to admin'}</button>
      </div>
    </form>
  </dialog>;
}

interface InboxRow {
  id: string;
  account_id: string;
  account_name: string;
  policy_number: string | null;
  carrier: string | null;
  policy_linked: boolean;
  requested_by: string;
  priority: number;
  description: string;
  created_at: string;
  outcome: 'handled' | 'declined' | null;
}

function PolicyInbox(): JSX.Element {
  const full = useStaffWorkspace() === 'full';
  const [closed, setClosed] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ rows: InboxRow[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void workspaceFetch<{ rows: InboxRow[]; more: boolean }>(`${endpoint}?closed=${closed}&page=${page}`, { signal: controller.signal })
      .then(setResult).catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to open the inbox.');
      });
    return () => controller.abort();
  }, [closed, page, revision]);

  const reload = (): void => { setCorrecting(null); setError(''); setResult(null); setRevision((value) => value + 1); };
  const resolve = async (id: string, outcome: 'handled' | 'declined'): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await workspaceFetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, outcome }) });
      if (result?.rows.length === 1 && page > 0) setPage(page - 1);
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update the request.');
    } finally { setBusy(false); }
  };

  return <section aria-label="Policy request inbox" className="mb-4" id="policy-request-inbox">
    <Card><CardBody>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Policy request inbox</h2>
        <div className="flex flex-wrap gap-2">
          {[false, true].map((value) => <button key={String(value)} type="button" className="crm-button"
            aria-pressed={closed === value} disabled={busy} onClick={() => {
              if (value !== closed) { setResult(null); setError(''); setPage(0); setClosed(value); }
            }}>{value ? 'Resolved' : 'Open'}</button>)}
          <button type="button" className="crm-button" disabled={busy} onClick={reload}>Refresh</button>
        </div>
      </div>
      {error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error}</p> : null}
      {!result && !error ? <p role="status" className="text-sm text-cui-muted">Loading requests...</p> : null}
      {result?.rows.length === 0 ? <p className="text-sm text-cui-muted">No {closed ? 'resolved' : 'open'} requests.</p> : null}
      <ul className="divide-y divide-cui-border">{result?.rows.map((row) => <li key={row.id} className="space-y-2 py-3 text-sm">
        <p className="font-semibold">{row.account_name} <span className="font-normal text-cui-muted">| {row.carrier} {row.policy_number}</span></p>
        <p><span className={`mr-2 rounded-full px-2 py-1 font-medium ${row.priority === 3 ? 'bg-cui-danger/20' : row.priority === 2 ? 'bg-cui-warning/25' : 'bg-cui-body'}`}>
          {priorityLabels[row.priority]}</span>{row.requested_by} · {new Date(row.created_at).toLocaleString()}</p>
        <p className="whitespace-pre-wrap break-words">{row.description}</p>
        {row.outcome ? <p className="capitalize text-cui-muted">{row.outcome}</p> : <div className="flex flex-wrap gap-2">
          {full && row.policy_linked ? <a className="crm-button" href={`/clients/${row.account_id}?tab=policies`}>Open account policies</a> : null}
          {row.policy_linked ? <button className="crm-button" type="button" disabled={busy} onClick={() => setCorrecting(row.id)}>Correct carrier or policy number</button>
            : <span className="text-cui-muted">Policy no longer linked to this account.</span>}
          <button type="button" className="crm-button crm-button-primary" disabled={busy} onClick={() => void resolve(row.id, 'handled')}>Mark handled</button>
          <button type="button" className="crm-button" disabled={busy} onClick={() => void resolve(row.id, 'declined')}>Decline</button>
        </div>}
        {!row.outcome && row.id === correcting ? <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError('');
          try {
            await workspaceFetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'correct-policy', id: row.id, carrier: form.get('carrier'), policy_number: form.get('policy_number') }) });
            reload();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Unable to save the correction.');
          } finally { setBusy(false); }
        }}>
          <label className="flex flex-col gap-1">Carrier<input name="carrier" className="crm-input" defaultValue={row.carrier ?? ''} maxLength={200} required disabled={busy} /></label>
          <label className="flex flex-col gap-1">Policy number<input name="policy_number" className="crm-input" defaultValue={row.policy_number ?? ''} maxLength={100} required disabled={busy} /></label>
          <button type="button" className="crm-button" disabled={busy} onClick={() => setCorrecting(null)}>Cancel</button>
          <button type="submit" className="crm-button crm-button-primary" disabled={busy}>Save correction</button>
        </form> : null}
      </li>)}</ul>
      {page > 0 || result?.more ? <nav aria-label="Policy inbox pages" className="mt-3 flex items-center gap-2">
        <button type="button" className="crm-button" disabled={!page || busy} onClick={() => { setResult(null); setError(''); setPage(page - 1); }}>Previous</button>
        <span>Page {page + 1}</span>
        <button type="button" className="crm-button" disabled={!result?.more || page === 10000 || busy}
          onClick={() => { setResult(null); setError(''); setPage(page + 1); }}>Next</button>
      </nav> : null}
    </CardBody></Card>
  </section>;
}

export function StaffPolicyInbox(): JSX.Element | null {
  const admin = usePolicyAdmin();
  const [open, setOpen] = useState(false);
  if (!admin) return null;
  return open ? <PolicyInbox /> : <button type="button" className="crm-button mb-4" onClick={() => setOpen(true)}>Open policy request inbox</button>;
}
