"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Claim {
  id: string;
  policy_id: string;
  client_id: string;
  version: number;
  type: string;
  status: string;
  description?: string | null;
  date_of_loss: string;
  created_at: string;
  policies?: { insured_name?: string; carrier?: string } | null;
  clients?: { full_name?: string } | null;
  events?: ClaimEvent[];
}

interface ClaimEvent {
  id: string;
  actor_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string;
  snapshot: Record<string, unknown>;
  created_at: string;
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
  const [statusFilter, setStatusFilter] = useState('open');
  const [historyClaimId, setHistoryClaimId] = useState<string | null>(null);
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

    const res = await fetch(`/api/claims?status=${statusFilter}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Claims could not be loaded. Refresh the page to try again.');
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
  }, [statusFilter]);

  useEffect(() => {
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
      const payload = (await res.json().catch(() => ({ message: 'Claim could not be created. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Claim could not be created. Please try again.');
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
        version: editingClaim.version,
        policy_id: editingClaim.policy_id,
        client_id: editingClaim.client_id,
        type: editingClaim.type,
        status: editingClaim.status,
        description: editingClaim.description || '',
        date_of_loss: editingClaim.date_of_loss,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Claim could not be updated. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Claim could not be updated. Please try again.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingClaim(null);
    await fetchClaims();
  };

  const handleRemoveClaim = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Close this claim? It will remain in the account history.');
    if (!confirmed) return;

    const res = await fetch('/api/claims', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Claim could not be removed. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Claim could not be removed. Please try again.');
      return;
    }

    await fetchClaims();
  };

  return (
    <SectionLayout title="Claims">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-cui-muted">Open claims tied directly to policy and client records.</p>
        <button
          type="button"
          onClick={() => setShowNewClaim(true)}
          className="rounded-lg border border-cui-primary-hover bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover"
        >
          + New Claim
        </button>
      </div>

      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-cui-muted">Loading claims...</div> : null}

      {!loading ? (
        <div className="rounded-lg border border-cui-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-cui-light px-3 py-2">
            <p className="text-xs text-cui-muted">Claim updates are recorded with agent and timestamp.</p>
            <select
              aria-label="Claim status filter"
              className="rounded-lg border border-cui-border px-2 py-1 text-xs"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="open">Open</option>
              <option value="in_review">In Review</option>
              <option value="closed">Closed</option>
              <option value="all">All claims</option>
            </select>
          </div>
          {claims.length === 0 ? (
            <div className="p-4 text-sm text-cui-muted">No claims found for this filter.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-cui-light text-cui-muted">
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
                  <React.Fragment key={claim.id}>
                  <tr className="border-t border-cui-light">
                    <td className="px-3 py-2 font-semibold text-cui-primary-strong">{claim.policies?.insured_name ?? claim.clients?.full_name ?? '--'}</td>
                    <td className="px-3 py-2">{claim.policies?.carrier ?? '--'}</td>
                    <td className="px-3 py-2">{claim.type}</td>
                    <td className="px-3 py-2">{claim.date_of_loss}</td>
                    <td className="px-3 py-2">{claim.status}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" className="mr-2 font-semibold text-cui-primary-strong hover:underline" onClick={() => setEditingClaim(claim)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="mr-2 font-semibold text-cui-primary-strong hover:underline"
                        onClick={() => setHistoryClaimId(historyClaimId === claim.id ? null : claim.id)}
                      >
                        History ({claim.events?.length ?? 0})
                      </button>
                      <button type="button" className="font-semibold text-[#c23934] hover:underline" onClick={() => void handleRemoveClaim(claim.id)}>
                        Close
                      </button>
                    </td>
                  </tr>
                  {historyClaimId === claim.id ? (
                    <tr className="border-t border-cui-light bg-cui-light">
                      <td colSpan={6} className="px-4 py-3">
                        {claim.events?.length ? (
                          <ol className="space-y-2">
                            {claim.events.map((event) => (
                              <li key={event.id} className="text-xs text-cui-muted">
                                <span className="font-semibold">{event.event_type.replaceAll('_', ' ')}</span>
                                {event.from_status ? `: ${event.from_status} to ${event.to_status}` : `: ${event.to_status}`}
                                {' - '}{new Date(event.created_at).toLocaleString()}
                                {typeof event.snapshot.description === 'string' ? ` - ${event.snapshot.description}` : ''}
                              </li>
                            ))}
                          </ol>
                        ) : <p className="text-xs text-cui-muted">No recorded changes yet.</p>}
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {showNewClaim ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-cui-text">New Claim</h2>

            <form onSubmit={handleCreateClaim} className="space-y-2">
              <select
                required
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={newClaim.date_of_loss}
                onChange={(e) => setNewClaim((prev) => ({ ...prev, date_of_loss: e.target.value }))}
              />

              <textarea
                placeholder="Description"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={newClaim.description}
                onChange={(e) => setNewClaim((prev) => ({ ...prev, description: e.target.value }))}
              />

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover disabled:opacity-60"
              >
                {isCreating ? 'Saving Claim...' : 'Save Claim'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewClaim(false)}
                className="w-full rounded-lg bg-cui-body px-3 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingClaim ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-cui-text">Edit Claim</h2>
            <form onSubmit={handleUpdateClaim} className="space-y-2">
              <select
                required
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClaim.date_of_loss}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, date_of_loss: e.target.value } : prev))}
              />
              <textarea
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingClaim.description || ''}
                onChange={(e) => setEditingClaim((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
              <select
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover disabled:opacity-60"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditingClaim(null)}
                className="w-full rounded-lg bg-cui-body px-3 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border"
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
