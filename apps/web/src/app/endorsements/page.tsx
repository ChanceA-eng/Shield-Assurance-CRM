"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Endorsement {
  id: string;
  policy_id: string;
  client_id: string;
  type: string;
  description?: string | null;
  effective_date: string;
  status: string;
  created_at: string;
  policies?: { insured_name?: string; carrier?: string } | null;
  clients?: { full_name?: string } | null;
}

interface PolicyOption {
  id: string;
  client_id: string;
  insured_name: string;
  carrier: string;
}

interface NewEndorsementForm {
  policy_id: string;
  client_id: string;
  type: string;
  description: string;
  effective_date: string;
  status: 'open';
}

export default function EndorsementsPage(): JSX.Element {
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewEndorsement, setShowNewEndorsement] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingEndorsement, setEditingEndorsement] = useState<Endorsement | null>(null);
  const [newEndorsement, setNewEndorsement] = useState<NewEndorsementForm>({
    policy_id: '',
    client_id: '',
    type: '',
    description: '',
    effective_date: '',
    status: 'open',
  });

  const fetchEndorsements = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/endorsements?status=open', { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load endorsements.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Endorsement[];
    setEndorsements(data);
    setLoading(false);
  };

  const fetchPolicies = async (): Promise<void> => {
    const res = await fetch('/api/policies', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as PolicyOption[];
    setPolicies(data);
  };

  useEffect(() => {
    void fetchEndorsements();
    void fetchPolicies();
  }, []);

  const handleCreateEndorsement = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/endorsements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEndorsement),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create endorsement.' }))) as {
        message?: string;
      };
      setError(payload.message ?? 'Failed to create endorsement.');
      setIsCreating(false);
      return;
    }

    setShowNewEndorsement(false);
    setIsCreating(false);
    setNewEndorsement({
      policy_id: '',
      client_id: '',
      type: '',
      description: '',
      effective_date: '',
      status: 'open',
    });
    await fetchEndorsements();
  };

  const handleUpdateEndorsement = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingEndorsement) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/endorsements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingEndorsement.id,
        policy_id: editingEndorsement.policy_id,
        client_id: editingEndorsement.client_id,
        type: editingEndorsement.type,
        description: editingEndorsement.description || '',
        effective_date: editingEndorsement.effective_date,
        status: editingEndorsement.status,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update endorsement.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update endorsement.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingEndorsement(null);
    await fetchEndorsements();
  };

  const handleRemoveEndorsement = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this endorsement? This action cannot be undone.');
    if (!confirmed) return;

    const res = await fetch('/api/endorsements', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove endorsement.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove endorsement.');
      return;
    }

    await fetchEndorsements();
  };

  return (
    <SectionLayout title="Endorsements">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Open policy changes linked directly to client and policy records.</p>
        <button
          type="button"
          onClick={() => setShowNewEndorsement(true)}
          className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
        >
          + New Endorsement
        </button>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading endorsements...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {endorsements.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No open endorsements found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Insured</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Effective Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {endorsements.map((endorsement) => (
                  <tr key={endorsement.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">
                      {endorsement.policies?.insured_name ?? endorsement.clients?.full_name ?? '--'}
                    </td>
                    <td className="px-3 py-2">{endorsement.policies?.carrier ?? '--'}</td>
                    <td className="px-3 py-2">{endorsement.type}</td>
                    <td className="px-3 py-2">{endorsement.effective_date}</td>
                    <td className="px-3 py-2">{endorsement.status}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        type="button"
                        className="mr-2 font-semibold text-[#0f62af] hover:underline"
                        onClick={() => setEditingEndorsement(endorsement)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="font-semibold text-[#c23934] hover:underline"
                        onClick={() => void handleRemoveEndorsement(endorsement.id)}
                      >
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

      {showNewEndorsement ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">New Endorsement</h2>

            <form onSubmit={handleCreateEndorsement} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newEndorsement.policy_id}
                onChange={(e) => {
                  const selected = policies.find((policy) => policy.id === e.target.value);
                  setNewEndorsement((prev) => ({
                    ...prev,
                    policy_id: e.target.value,
                    client_id: selected?.client_id ?? '',
                  }));
                }}
              >
                <option value="">Select Policy</option>
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.insured_name} - {policy.carrier}
                  </option>
                ))}
              </select>

              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newEndorsement.type}
                onChange={(e) => setNewEndorsement((prev) => ({ ...prev, type: e.target.value }))}
              >
                <option value="">Endorsement Type</option>
                <option value="Address Change">Address Change</option>
                <option value="Vehicle Change">Vehicle Change</option>
                <option value="Driver Change">Driver Change</option>
                <option value="Coverage Change">Coverage Change</option>
              </select>

              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newEndorsement.effective_date}
                onChange={(e) => setNewEndorsement((prev) => ({ ...prev, effective_date: e.target.value }))}
              />

              <textarea
                placeholder="Description"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newEndorsement.description}
                onChange={(e) => setNewEndorsement((prev) => ({ ...prev, description: e.target.value }))}
              />

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isCreating ? 'Saving Endorsement...' : 'Save Endorsement'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewEndorsement(false)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingEndorsement ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Endorsement</h2>
            <form onSubmit={handleUpdateEndorsement} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingEndorsement.policy_id}
                onChange={(e) =>
                  setEditingEndorsement((prev) => {
                    if (!prev) return prev;
                    const selected = policies.find((policy) => policy.id === e.target.value);
                    return { ...prev, policy_id: e.target.value, client_id: selected?.client_id ?? prev.client_id };
                  })
                }
              >
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.insured_name} - {policy.carrier}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingEndorsement.type}
                onChange={(e) => setEditingEndorsement((prev) => (prev ? { ...prev, type: e.target.value } : prev))}
              />
              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingEndorsement.effective_date}
                onChange={(e) => setEditingEndorsement((prev) => (prev ? { ...prev, effective_date: e.target.value } : prev))}
              />
              <textarea
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingEndorsement.description || ''}
                onChange={(e) => setEditingEndorsement((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingEndorsement.status}
                onChange={(e) => setEditingEndorsement((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                <option value="open">Open</option>
                <option value="completed">Completed</option>
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
                onClick={() => setEditingEndorsement(null)}
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
