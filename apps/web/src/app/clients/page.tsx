"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';

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
  const [clients, setClients] = useState<Client[]>([]);
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

    const res = await fetch('/api/clients', { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load clients.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Client[];
    setClients(data);
    setLoading(false);
  };

  useEffect(() => {
    void fetchClients();
  }, []);

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
    <SectionLayout title="Clients">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Book of business: clients are auto-created from issued policies, with manual backup entry.</p>
        <button
          type="button"
          onClick={() => setShowNewClient(true)}
          className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
        >
          + New Client
        </button>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading clients...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {clients.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No clients found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Consent</th>
                  <th className="px-3 py-2">Preferred</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">
                      <Link href={`/clients/${client.id}`} className="hover:underline">
                        {client.full_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{client.phone || '--'}</td>
                    <td className="px-3 py-2">{client.email || '--'}</td>
                    <td className="px-3 py-2">{client.address || '--'}</td>
                    <td className="px-3 py-2">{client.source || '--'}</td>
                    <td className="px-3 py-2 text-xs text-[#3e3e3c]">
                      {client.email_consent ? 'Email' : 'No Email'} · {client.sms_consent ? 'SMS' : 'No SMS'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#3e3e3c]">{client.preferred_channel || 'email'}</td>
                    <td className="px-3 py-2">{new Date(client.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" className="mr-2 font-semibold text-[#0f62af] hover:underline" onClick={() => setEditingClient(client)}>
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

      {showNewClient ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">New Client</h2>
            <form onSubmit={handleCreateClient} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Full Name"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClient.full_name}
                onChange={(e) => setNewClient((prev) => ({ ...prev, full_name: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Phone"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClient.phone}
                onChange={(e) => setNewClient((prev) => ({ ...prev, phone: e.target.value }))}
              />
              <input
                type="email"
                placeholder="Email"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClient.email}
                onChange={(e) => setNewClient((prev) => ({ ...prev, email: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Address"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClient.address}
                onChange={(e) => setNewClient((prev) => ({ ...prev, address: e.target.value }))}
              />
              <input
                required
                type="text"
                placeholder="Source"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClient.source}
                onChange={(e) => setNewClient((prev) => ({ ...prev, source: e.target.value }))}
              />

              <label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
                <input
                  type="checkbox"
                  checked={newClient.email_consent}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, email_consent: e.target.checked }))}
                />
                I agree to receive emails about my insurance.
              </label>

              <label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
                <input
                  type="checkbox"
                  checked={newClient.sms_consent}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, sms_consent: e.target.checked }))}
                />
                I agree to receive text messages about my insurance.
              </label>

              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
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
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isCreating ? 'Saving Client...' : 'Save Client'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewClient(false)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingClient ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Client</h2>
            <form onSubmit={handleUpdateClient} className="space-y-2">
              <input
                required
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClient.full_name}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, full_name: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClient.phone || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
              />
              <input
                type="email"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClient.email || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClient.address || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, address: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClient.source || ''}
                onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, source: e.target.value } : prev))}
              />
              <label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.email_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, email_consent: e.target.checked } : prev))}
                />
                Email consent
              </label>
              <label className="flex items-center gap-2 text-sm text-[#3e3e3c]">
                <input
                  type="checkbox"
                  checked={Boolean(editingClient.sms_consent)}
                  onChange={(e) => setEditingClient((prev) => (prev ? { ...prev, sms_consent: e.target.checked } : prev))}
                />
                SMS consent
              </label>
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
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
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
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
