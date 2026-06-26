"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Claim {
  id: string;
  policy_id: string;
  client_id: string;
  type: string;
  status: string;
  description?: string | null;
  date_of_loss: string;
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

interface NewClaimForm {
  policy_id: string;
  client_id: string;
  type: string;
  status: 'open';
  description: string;
  date_of_loss: string;
}

export default function ClaimsPage(): JSX.Element {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewClaim, setShowNewClaim] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [newClaim, setNewClaim] = useState<NewClaimForm>({
    policy_id: '',
    client_id: '',
    type: '',
    status: 'open',
    description: '',
    date_of_loss: '',
  });

  const fetchClaims = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/claims?status=open', { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load claims.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Claim[];
    setClaims(data);
    setLoading(false);
  };

  const fetchPolicies = async (): Promise<void> => {
    const res = await fetch('/api/policies', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as PolicyOption[];
    setPolicies(data);
  };

  useEffect(() => {
    void fetchClaims();
    void fetchPolicies();
  }, []);

  const handleCreateClaim = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClaim),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create claim.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create claim.');
      setIsCreating(false);
      return;
    }

    setShowNewClaim(false);
    setIsCreating(false);
    setNewClaim({
      policy_id: '',
      client_id: '',
      type: '',
      status: 'open',
      description: '',
      date_of_loss: '',
    });
    await fetchClaims();
  };

  const handleUpdateClaim = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingClaim) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/claims', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingClaim.id,
        policy_id: editingClaim.policy_id,
        client_id: editingClaim.client_id,
        type: editingClaim.type,
        status: editingClaim.status,
        description: editingClaim.description || '',
        date_of_loss: editingClaim.date_of_loss,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update claim.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update claim.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingClaim(null);
    await fetchClaims();
  };

  const handleRemoveClaim = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this claim? This action cannot be undone.');
    if (!confirmed) return;

    const res = await fetch('/api/claims', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove claim.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove claim.');
      return;
    }

    await fetchClaims();
  };

  return (
    <SectionLayout title="Claims">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Open claims tied directly to policy and client records.</p>
        <button
          type="button"
          onClick={() => setShowNewClaim(true)}
          className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
        >
          + New Claim
        </button>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading claims...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {claims.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No open claims found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Insured</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date of Loss</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">{claim.policies?.insured_name ?? claim.clients?.full_name ?? '--'}</td>
                    <td className="px-3 py-2">{claim.policies?.carrier ?? '--'}</td>
                    <td className="px-3 py-2">{claim.type}</td>
                    <td className="px-3 py-2">{claim.date_of_loss}</td>
                    <td className="px-3 py-2">{claim.status}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" className="mr-2 font-semibold text-[#0f62af] hover:underline" onClick={() => setEditingClaim(claim)}>
                        Edit
                      </button>
                      <button type="button" className="font-semibold text-[#c23934] hover:underline" onClick={() => void handleRemoveClaim(claim.id)}>
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

      {showNewClaim ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">New Claim</h2>

            <form onSubmit={handleCreateClaim} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClaim.policy_id}
                onChange={(e) => {
                  const selected = policies.find((policy) => policy.id === e.target.value);
                  setNewClaim((prev) => ({
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
                value={newClaim.type}
                onChange={(e) => setNewClaim((prev) => ({ ...prev, type: e.target.value }))}
              >
                <option value="">Claim Type</option>
                <option value="Auto">Auto</option>
                <option value="Home">Home</option>
                <option value="Liability">Liability</option>
                <option value="Commercial">Commercial</option>
              </select>

              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClaim.date_of_loss}
                onChange={(e) => setNewClaim((prev) => ({ ...prev, date_of_loss: e.target.value }))}
              />

              <textarea
                placeholder="Description"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newClaim.description}
                onChange={(e) => setNewClaim((prev) => ({ ...prev, description: e.target.value }))}
              />

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isCreating ? 'Saving Claim...' : 'Save Claim'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewClaim(false)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingClaim ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Claim</h2>
            <form onSubmit={handleUpdateClaim} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClaim.policy_id}
                onChange={(e) =>
                  setEditingClaim((prev) => {
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
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClaim.type}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, type: e.target.value } : prev))}
              >
                <option value="Auto">Auto</option>
                <option value="Home">Home</option>
                <option value="Liability">Liability</option>
                <option value="Commercial">Commercial</option>
              </select>
              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClaim.date_of_loss}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, date_of_loss: e.target.value } : prev))}
              />
              <textarea
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClaim.description || ''}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingClaim.status}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                <option value="open">Open</option>
                <option value="in_review">In Review</option>
                <option value="closed">Closed</option>
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
                onClick={() => setEditingClaim(null)}
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
