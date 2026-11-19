"use client";

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody } from '../../components/ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useNotifications } from '../../context/NotificationContext';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import type { DirectoryFilter, DirectoryResult, DirectoryRow } from '../../lib/client-directory';
import AccountPolicyIntake from '../../components/crm/AccountPolicyIntake';
import NewAccountIntakeForm from '../../components/crm/NewAccountIntakeForm';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { useStaffWorkspace } from '../../context/StaffWorkspaceContext';
import StaffRecordList from '../../components/crm/StaffRecordList';

interface Client {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  email_consent?: boolean | null;
  sms_consent?: boolean | null;
  preferred_channel?: string | null;
  policy_effective_at?: string | null;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
  created_at: string;
}

export default function ClientsPage(): JSX.Element {
  return useStaffWorkspace() === 'full' ? <ClientsContent /> : <StaffRecordList kind="accounts" />;
}

function ClientsContent(): JSX.Element {
  const [clients, setClients] = useState<DirectoryRow[]>([]);
  const [search, setSearch] = useState('');
  const { unreadMessages } = useNotifications();
  const [filter, setFilter] = useState<DirectoryFilter>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const loadVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editBaseline, setEditBaseline] = useState('');
  const { confirmDiscard, markSaved } = useUnsavedChanges(Boolean(editingClient) && JSON.stringify(editingClient) !== editBaseline);
  const closeEditor = (): void => { if (!isSavingEdit && confirmDiscard()) setEditingClient(null); };

  const fetchClients = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const version = ++loadVersion.current;
    try {
      const data = await workspaceFetch<DirectoryResult>(`/api/clients/directory?q=${encodeURIComponent(search)}&filter=${filter}&page=${page}`);
      if (version !== loadVersion.current) return;
      if (page > 0 && page * data.page_size >= data.total) { setPage(Math.max(0, Math.ceil(data.total / data.page_size) - 1)); return; }
      setClients(data.items);
      setTotal(data.total);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Accounts could not be loaded. Refresh the page to try again.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void fetchClients(), 250);
    return () => { clearTimeout(timer); loadVersion.current++; };
  }, [search, filter, page]);

  const handleUpdateClient = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingClient) return;
    setIsSavingEdit(true);
    setError(null);

    try {
      await workspaceFetch('/api/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingClient) });
      markSaved(); setEditingClient(null); await fetchClients();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Account could not be updated. Please try again.');
    } finally { setIsSavingEdit(false); }
  };

  const handleRemoveClient = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this client? This action cannot be undone.');
    if (!confirmed) return;

    const res = await fetch('/api/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Client could not be removed. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Client could not be removed. Please try again.');
      return;
    }

    await fetchClients();
  };

  return (
    <SectionLayout title="Accounts">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cui-muted">{total} accounts in your book of business.</p>
        <button
          type="button"
          onClick={() => setShowNewClient(true)}
          className="crm-button-primary"
        >
          + New Account
        </button>
      </div>

      <Card className="mb-4">
        <CardBody>
          <label className="block text-sm font-semibold text-cui-text">Search accounts
            <input type="search" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }}
              placeholder="Name, business, email, phone or policy number"
              className="crm-input mt-2 font-normal" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Account filters">
            {([['all', 'All accounts'], ['active', 'Active clients'], ['prospect', 'Prospects'], ['former', 'Former clients'],
              ['renewals', 'Renewals in 30 days'], ['overdue', 'Overdue work']] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}
                className="crm-tab">{label}</button>)}
          </div>
        </CardBody>
      </Card>
      {error ? <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error} <button onClick={() => void fetchClients()} className="underline">Retry</button></div> : null}
      {loading ? <div className="text-sm text-cui-muted">Loading clients...</div> : null}

      {!loading && !error ? (
        <div className="overflow-x-auto rounded-xl border border-cui-border bg-cui-panel shadow-card">
          {clients.length === 0 ? (
            <div className="p-4 text-sm text-cui-muted">No clients found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-cui-light text-cui-muted">
                <tr>
                  <th className="px-3 py-2">Account / Contact</th>
                  <th className="px-3 py-2">Policy status</th>
                  <th className="px-3 py-2">Next action</th>
                  <th className="px-3 py-2">Assigned agent</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-t border-cui-border/60 transition hover:bg-cui-light/70">
                    <td className="px-3 py-2 font-semibold text-cui-primary-strong">
                      <div className="flex items-center gap-2">
                        <Link href={`/clients/${client.id}`} className="hover:underline">
                          {client.full_name}
                        </Link>
                        {(unreadMessages.byClient[client.id] ?? 0) > 0 ? (
                          <Link
                            href={`/clients/${client.id}?tab=communication`}
                            className="rounded-full bg-cui-danger px-2 py-0.5 text-[11px] font-bold text-white"
                            title="Unread messages from this account"
                          >
                            {unreadMessages.byClient[client.id]} new message{unreadMessages.byClient[client.id] === 1 ? '' : 's'}
                          </Link>
                        ) : null}
                      </div>
                      {client.business_names.map((name) => <p key={name} className="text-xs text-cui-muted">{name}</p>)}
                      <p className="mt-1 font-normal text-cui-muted">{client.email || 'Email not recorded'}</p>
                      <p className="font-normal text-cui-muted">{client.phone || 'Phone not recorded'}</p>
                    </td>
                    <td className="px-3 py-2"><span className="rounded-lg bg-cui-light px-2 py-1 text-xs font-semibold">{client.lifecycle}</span>
                      <p className="mt-2 text-xs text-cui-muted">{client.policy_count} policies</p>
                      {client.renewal_date ? <p className="text-xs text-cui-muted">Next expiration {client.renewal_date}</p> : null}
                    </td>
                    <td className="max-w-xs px-3 py-2">
                      {client.next_task ? <Link href={`/clients/${client.id}?tab=tasks`} className="font-semibold text-cui-primary hover:underline">{client.next_task.subject}</Link> : 'No open tasks'}
                      {client.next_task?.due_date ? <p className="text-xs text-cui-muted">{formatArizonaDateTime(client.next_task.due_date)} AZ</p> : null}
                      {client.overdue_count > 0 ? <p className="text-xs font-semibold text-cui-danger">{client.overdue_count} overdue</p> : null}
                    </td>
                    <td className="px-3 py-2">{client.assigned_producer || 'Unassigned'}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" className="mr-2 font-semibold text-cui-primary-strong hover:underline" onClick={() => { setEditBaseline(JSON.stringify(client)); setEditingClient(client); setError(null); }}>
                        Edit
                      </button>
                      <button type="button" className="font-semibold text-[#c23934] hover:underline" onClick={() => void handleRemoveClient(client.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      {!loading && !error ? <div className="mt-3 flex items-center justify-between gap-3 text-sm text-cui-muted">
        <p role="status">{total} matching accounts · Page {page + 1} of {Math.max(1, Math.ceil(total / 25))}</p>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="crm-button">Previous</button>
          <button disabled={(page + 1) * 25 >= total} onClick={() => setPage((value) => value + 1)} className="crm-button">Next</button>
        </div>
      </div> : null}

      {showNewClient ? (
        <AccountPolicyIntake intent="account">
          <NewAccountIntakeForm onCreated={async () => { setShowNewClient(false); await fetchClients(); }}
            onCancel={() => setShowNewClient(false)} />
        </AccountPolicyIntake>
      ) : null}

      {editingClient ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open) closeEditor(); }}><Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm" />
          <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
            <div className="mb-4 flex items-center justify-between"><Dialog.Title className="text-lg font-bold">Edit account</Dialog.Title>
              <button type="button" onClick={closeEditor} disabled={isSavingEdit} className="rounded-lg p-2 text-cui-muted hover:bg-cui-light" aria-label="Close account editor"><X className="h-4 w-4" /></button></div>
            <Dialog.Description className="sr-only">Update account contact information and communication preferences.</Dialog.Description>
            <form onSubmit={handleUpdateClient} className="space-y-2">
              <input
                required
                type="text"
                aria-label="Account name"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.full_name}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, full_name: e.target.value } : prev))}
              />
              <input
                type="text"
                aria-label="Phone"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.phone || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
              />
              <input
                type="email"
                aria-label="Email"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.email || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
              />
              <input
                type="text"
                aria-label="Address"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.address || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, address: e.target.value } : prev))}
              />
              <input
                type="text"
                aria-label="Source"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.source || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, source: e.target.value } : prev))}
              />
              <label className="flex items-center gap-2 text-sm text-cui-muted">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.email_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email_consent: e.target.checked } : prev))}
                />
                Email consent
              </label>
              <label className="flex items-center gap-2 text-sm text-cui-muted">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.sms_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, sms_consent: e.target.checked } : prev))}
                />
                SMS consent
              </label>
              <select
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClient.preferred_channel || 'email'}
                onChange={(e) =>
                  setEditingClient((prev) => (prev ? { ...prev, preferred_channel: e.target.value as Client['preferred_channel'] } : prev))
                }
              >
                <option value="email">Preferred Contact: Email</option>
                <option value="sms">Preferred Contact: SMS</option>
                <option value="both">Preferred Contact: Both</option>
              </select>

              {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
              <button
                type="submit"
                disabled={isSavingEdit}
                className="crm-button-primary w-full"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={closeEditor}
                className="crm-button w-full"
              >
                Cancel
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal></Dialog.Root>
      ) : null}
    </SectionLayout>
  );
}
