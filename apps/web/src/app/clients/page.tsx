"use client";

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody } from '../../components/ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useNotifications } from '../../context/NotificationContext';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import type { DirectoryFilter, DirectoryResult, DirectoryRow } from '../../lib/client-directory';

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

interface NewClientForm {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  email_consent: boolean;
  sms_consent: boolean;
  preferred_channel: 'email' | 'sms' | 'both';
}

export default function ClientsPage(): JSX.Element {
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
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState<NewClientForm>({
    full_name: '',
    phone: '',
    email: '',
    address: '',
    source: '',
    email_consent: false,
    sms_consent: false,
    preferred_channel: 'email',
  });

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
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Failed to load accounts.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void fetchClients(), 250);
    return () => { clearTimeout(timer); loadVersion.current++; };
  }, [search, filter, page]);

  const handleCreateClient = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create client.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create client.');
      setIsCreating(false);
      return;
    }

    setIsCreating(false);
    setShowNewClient(false);
    setNewClient({ full_name: '', phone: '', email: '', address: '', source: '', email_consent: false, sms_consent: false, preferred_channel: 'email' });
    await fetchClients();
  };

  const handleUpdateClient = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingClient) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingClient),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update client.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update client.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingClient(null);
    await fetchClients();
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
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove client.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove client.');
      return;
    }

    await fetchClients();
  };

  return (
    <SectionLayout title="Accounts">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cui-muted">Your book of business and prospect accounts. Client status comes from placed policies.</p>
        <button
          type="button"
          onClick={() => setShowNewClient(true)}
          className="rounded border border-[#1b8eb7] bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7]"
        >
          + New Account
        </button>
      </div>

      <Card className="mb-4">
        <CardBody>
          <label className="block text-sm font-semibold text-cui-text">Search accounts
            <input type="search" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }}
              placeholder="Name, business, email, phone or policy number"
              className="mt-2 w-full rounded border border-cui-border px-3 py-2 font-normal" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Account filters">
            {([['all', 'All accounts'], ['active', 'Active clients'], ['prospect', 'Prospects'], ['former', 'Former clients'],
              ['renewals', 'Renewals in 30 days'], ['overdue', 'Overdue work']] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}
                className={`rounded border px-3 py-1.5 text-sm ${filter === value ? 'border-cui-primary bg-cui-primary text-white' : 'border-cui-border text-cui-text'}`}>{label}</button>)}
          </div>
        </CardBody>
      </Card>
      {error ? <div role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error} <button onClick={() => void fetchClients()} className="underline">Retry</button></div> : null}
      {loading ? <div className="text-sm text-[#73818f]">Loading clients...</div> : null}

      {!loading && !error ? (
        <div className="overflow-x-auto rounded border border-cui-border bg-white shadow-sm">
          {clients.length === 0 ? (
            <div className="p-4 text-sm text-[#73818f]">No clients found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f9fa] text-[#73818f]">
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
                  <tr key={client.id} className="border-t border-[#f0f3f5]">
                    <td className="px-3 py-2 font-semibold text-[#20a8d8]">
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
                    <td className="px-3 py-2"><span className="rounded bg-cui-light px-2 py-1 text-xs font-semibold">{client.lifecycle}</span>
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
                      <button type="button" className="mr-2 font-semibold text-[#167495] hover:underline" onClick={() => setEditingClient(client)}>
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
          <button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="rounded border border-cui-border px-3 py-1 disabled:opacity-40">Previous</button>
          <button disabled={(page + 1) * 25 >= total} onClick={() => setPage((value) => value + 1)} className="rounded border border-cui-border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div> : null}

      {showNewClient ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#23282c]">New Account</h2>
            <form onSubmit={handleCreateClient} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Full Name"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.full_name}
                onChange={(e) => setNewClient((prev) => ({ ...prev, full_name: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Phone"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.phone}
                onChange={(e) => setNewClient((prev) => ({ ...prev, phone: e.target.value }))}
              />
              <input
                type="email"
                placeholder="Email"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.email}
                onChange={(e) => setNewClient((prev) => ({ ...prev, email: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Address"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.address}
                onChange={(e) => setNewClient((prev) => ({ ...prev, address: e.target.value }))}
              />
              <input
                required
                type="text"
                placeholder="Source"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.source}
                onChange={(e) => setNewClient((prev) => ({ ...prev, source: e.target.value }))}
              />

              <label className="flex items-center gap-2 text-sm text-[#5c6873]">
                <input
                  type="checkbox"
                  checked={newClient.email_consent}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, email_consent: e.target.checked }))}
                />
                I agree to receive emails about my insurance.
              </label>

              <label className="flex items-center gap-2 text-sm text-[#5c6873]">
                <input
                  type="checkbox"
                  checked={newClient.sms_consent}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, sms_consent: e.target.checked }))}
                />
                I agree to receive text messages about my insurance.
              </label>

              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={newClient.preferred_channel}
                onChange={(e) => setNewClient((prev) => ({ ...prev, preferred_channel: e.target.value as NewClientForm['preferred_channel'] }))}
              >
                <option value="email">Preferred Contact: Email</option>
                <option value="sms">Preferred Contact: SMS</option>
                <option value="both">Preferred Contact: Both</option>
              </select>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60"
              >
                {isCreating ? 'Saving Client...' : 'Save Client'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewClient(false)}
                className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingClient ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#23282c]">Edit Client</h2>
            <form onSubmit={handleUpdateClient} className="space-y-2">
              <input
                required
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.full_name}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, full_name: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.phone || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
              />
              <input
                type="email"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.email || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.address || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, address: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.source || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, source: e.target.value } : prev))}
              />
              <label className="flex items-center gap-2 text-sm text-[#5c6873]">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.email_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email_consent: e.target.checked } : prev))}
                />
                Email consent
              </label>
              <label className="flex items-center gap-2 text-sm text-[#5c6873]">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.sms_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, sms_consent: e.target.checked } : prev))}
                />
                SMS consent
              </label>
              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingClient.preferred_channel || 'email'}
                onChange={(e) =>
                  setEditingClient((prev) => (prev ? { ...prev, preferred_channel: e.target.value as Client['preferred_channel'] } : prev))
                }
              >
                <option value="email">Preferred Contact: Email</option>
                <option value="sms">Preferred Contact: SMS</option>
                <option value="both">Preferred Contact: Both</option>
              </select>

              <button
                type="submit"
                disabled={isSavingEdit}
                className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
