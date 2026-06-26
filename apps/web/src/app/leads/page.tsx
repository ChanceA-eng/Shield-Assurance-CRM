'use client';

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Lead {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  source: string;
  line_of_business: string;
  status: string;
  created_at: string;
}

interface NewLeadForm {
  full_name: string;
  phone: string;
  email: string;
  line_of_business: string;
  source: string;
  status: 'new';
}

export default function LeadsPage(): JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [newLead, setNewLead] = useState<NewLeadForm>({
    full_name: '',
    phone: '',
    email: '',
    line_of_business: '',
    source: '',
    status: 'new',
  });

  const fetchLeads = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/leads?owner=me&status=open', { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load leads.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Lead[];
    setLeads(data);
    setLoading(false);
  };

  useEffect(() => {
    void (async () => {
      await fetchLeads();
    })();
  }, []);

  const handleCreateLead = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create lead.');
      setIsCreating(false);
      return;
    }

    setShowNewLead(false);
    setNewLead({
      full_name: '',
      phone: '',
      email: '',
      line_of_business: '',
      source: '',
      status: 'new',
    });
    setIsCreating(false);
    await fetchLeads();
  };

  const handleUpdateLead = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingLead) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingLead),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update lead.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingLead(null);
    await fetchLeads();
  };

  const handleRemoveLead = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this lead? This action cannot be undone.');
    if (!confirmed) return;

    const res = await fetch('/api/leads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove lead.');
      return;
    }

    await fetchLeads();
  };

  return (
    <SectionLayout title="Leads">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Manage open insurance leads and intake.</p>
        <button
          type="button"
          onClick={() => setShowNewLead(true)}
          className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
        >
          + New Lead
        </button>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="text-sm text-[#6a6a6a]">Loading leads...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {leads.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No leads found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Line of Business</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">{lead.full_name}</td>
                    <td className="px-3 py-2">{lead.phone || '--'}</td>
                    <td className="px-3 py-2">{lead.email || '--'}</td>
                    <td className="px-3 py-2">{lead.line_of_business}</td>
                    <td className="px-3 py-2">{lead.source}</td>
                    <td className="px-3 py-2">{lead.status}</td>
                    <td className="px-3 py-2">{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" className="mr-2 font-semibold text-[#0f62af] hover:underline" onClick={() => setEditingLead(lead)}>
                        Edit
                      </button>
                      <button type="button" className="font-semibold text-[#c23934] hover:underline" onClick={() => void handleRemoveLead(lead.id)}>
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

      {showNewLead ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">New Lead</h2>
            <form onSubmit={handleCreateLead} className="space-y-2">
              <input
                required
                type="text"
                placeholder="Full Name"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newLead.full_name}
                onChange={(e) => setNewLead((prev) => ({ ...prev, full_name: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Phone"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newLead.phone}
                onChange={(e) => setNewLead((prev) => ({ ...prev, phone: e.target.value }))}
              />
              <input
                type="email"
                placeholder="Email"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newLead.email}
                onChange={(e) => setNewLead((prev) => ({ ...prev, email: e.target.value }))}
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newLead.line_of_business}
                onChange={(e) => setNewLead((prev) => ({ ...prev, line_of_business: e.target.value }))}
              >
                <option value="">Line of Business</option>
                <option value="Auto">Auto</option>
                <option value="Home">Home</option>
                <option value="Life">Life</option>
                <option value="Commercial">Commercial</option>
              </select>
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newLead.source}
                onChange={(e) => setNewLead((prev) => ({ ...prev, source: e.target.value }))}
              >
                <option value="">Lead Source</option>
                <option value="Walk-in">Walk-in</option>
                <option value="Phone Call">Phone Call</option>
                <option value="Referral">Referral</option>
                <option value="Facebook">Facebook</option>
                <option value="Google">Google</option>
              </select>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
                >
                  {isCreating ? 'Saving Lead...' : 'Save Lead'}
                </button>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setShowNewLead(false)}
                  className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingLead ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Lead</h2>
            <form onSubmit={handleUpdateLead} className="space-y-2">
              <input
                required
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.full_name}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, full_name: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.phone || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
              />
              <input
                type="email"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.email || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.line_of_business || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, line_of_business: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.source || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, source: e.target.value } : prev))}
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingLead.status}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                <option value="new">New</option>
                <option value="working">Working</option>
                <option value="quoted">Quoted</option>
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
                onClick={() => setEditingLead(null)}
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
