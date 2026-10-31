'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';

interface Account { id: string; full_name: string; email?: string | null; phone?: string | null }

export default function LeadAccountLink({ leadId, onLinked }: { leadId: string; onLinked: (id: string) => void }): JSX.Element {
  const [linked, setLinked] = useState<{ clientId: string | null; clientName: string | null } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/leads/${leadId}/workspace`;

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await workspaceFetch<{ clientId: string | null; clientName: string | null }>(endpoint);
      setLinked(data);
      setError(null);
      if (data.clientId) onLinked(data.clientId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load the account link.'); }
  }, [endpoint, onLinked]);
  useEffect(() => { void load(); }, [load]);

  const findAccounts = async (): Promise<void> => {
    setBusy(true);
    try { setAccounts(await workspaceFetch<Account[]>(`/api/clients?q=${encodeURIComponent(search)}`)); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to find accounts.'); }
    finally { setBusy(false); }
  };

  const link = async (create: boolean): Promise<void> => {
    setBusy(true);
    try {
      const data = await workspaceFetch<{ clientId: string }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(create ? { create: true } : { client_id: selected }) });
      onLinked(data.clientId);
      setOpen(false);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to link this account.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded border border-cui-border p-3 text-sm">
      <p className="font-semibold text-cui-text">Account continuity</p>
      {error ? <p role="alert" className="mt-1 text-cui-danger">{error}</p> : null}
      {linked?.clientId ? (
        <Link href={`/clients/${linked.clientId}` as Route} className="mt-1 block font-semibold text-cui-primary hover:underline">Open account: {linked.clientName}</Link>
      ) : (
        <>
          <p className="mt-1 text-xs text-cui-muted">Notes, assets and tasks can be saved now. Link the correct account when ready; do not merge people just because they share an email or name.</p>
          <button type="button" onClick={() => setOpen((value) => !value)} className="mt-2 text-xs font-semibold text-cui-primary">Link / create account</button>
          {open ? (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an existing account by name" aria-label="Find existing account"
                className="min-w-0 flex-1 rounded border border-cui-border px-2 py-1.5 text-sm" />
                <button type="button" disabled={busy} onClick={() => void findAccounts()} className="text-xs font-semibold text-cui-primary">Search</button></div>
              <select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Existing account" className="w-full rounded border border-cui-border px-2 py-1.5">
                <option value="">Select the correct existing account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.full_name} | {account.email || account.phone || 'No contact information'}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !selected} onClick={() => void link(false)} className="rounded bg-cui-primary px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Link selected account</button>
                <button type="button" disabled={busy} onClick={() => void link(true)} className="rounded border border-cui-border px-2 py-1 text-xs font-semibold text-cui-muted">Create separate prospect account</button>
              </div>
              <p className="text-xs text-cui-muted">Creating an account does not mark this person as an insured client or bind a policy.</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
