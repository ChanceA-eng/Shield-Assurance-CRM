'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';
import NewLeadModal from './NewLeadModal';

interface Lead {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  source: string;
  line_of_business: string;
  status: string;
  created_at: string;
  form_payload?: Record<string, unknown> | null;
}

interface NewLeadForm {
  full_name: string;
  phone: string;
  email: string;
  line_of_business: string;
  source: string;
  status: 'new';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderPayloadValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => renderPayloadValue(item)).join(', ');
  }

  if (value === null || typeof value === 'undefined') {
    return '--';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

export default function LeadsPage(): JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newLead, setNewLead] = useState<NewLeadForm>({
    full_name: '',
    phone: '',
    email: '',
    line_of_business: '',
    source: '',
    status: 'new',
  });

  const fetchLeads = async (showLoader = true): Promise<void> => {
    if (showLoader) {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetch('/api/leads?owner=me&status=open', { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to load leads.');
        return;
      }

      const data = (await res.json()) as Lead[];
      setLeads(data);
    } catch {
      setError('Network error while loading leads. Please try again.');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void (async () => {
      await fetchLeads(true);
    })();

    const refreshInterval = window.setInterval(() => {
      void fetchLeads(false);
    }, 10000);

    const refreshOnFocus = (): void => {
      void fetchLeads(false);
    };

    window.addEventListener('focus', refreshOnFocus);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', refreshOnFocus);
    };
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

  const payloadEntries = selectedLead?.form_payload
    ? Object.entries(selectedLead.form_payload).filter(([key]) => key !== '_request')
    : [];
  const requestContext = selectedLead?.form_payload && isRecord(selectedLead.form_payload._request) ? selectedLead.form_payload._request : null;
  const requestQuery = requestContext && isRecord(requestContext.query) ? Object.entries(requestContext.query) : [];
  const refererQuery = requestContext && isRecord(requestContext.referer_query) ? Object.entries(requestContext.referer_query) : [];

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
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">
                      <Link href={`/clients/workspace?lead=${lead.id}`} className="hover:underline">
                        {lead.full_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{lead.phone || '--'}</td>
                    <td className="px-3 py-2">{lead.email || '--'}</td>
                    <td className="px-3 py-2">{lead.line_of_business}</td>
                    <td className="px-3 py-2">{lead.source}</td>
                    <td className="px-3 py-2">{lead.status}</td>
                    <td className="px-3 py-2">{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        type="button"
                        className="mr-2 font-semibold text-[#1f3f5b] hover:underline"
                        onClick={() => setSelectedLead(lead)}
                      >
                        Details
                      </button>
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
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onSaved={() => {
            setShowNewLead(false);
            void fetchLeads();
          }}
        />
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

      {selectedLead ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#080707]">Lead Submission Details</h2>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="rounded bg-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Close
              </button>
            </div>

            <div className="mb-4 grid gap-2 text-sm text-[#2f2f2f] md:grid-cols-3">
              <div><span className="font-semibold">Name:</span> {selectedLead.full_name}</div>
              <div><span className="font-semibold">Line:</span> {selectedLead.line_of_business || '--'}</div>
              <div><span className="font-semibold">Source:</span> {selectedLead.source || '--'}</div>
            </div>

            <div className="mb-4 rounded border border-[#dddbda]">
              <div className="border-b border-[#f3f2f1] bg-[#f8f8f7] px-3 py-2 text-sm font-semibold text-[#3e3e3c]">Submitted Fields</div>
              {payloadEntries.length === 0 ? (
                <div className="p-3 text-sm text-[#6a6a6a]">No stored payload fields for this lead.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#fcfcfc] text-[#6a6a6a]">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payloadEntries.map(([key, value]) => (
                      <tr key={key} className="border-t border-[#f3f2f1]">
                        <td className="px-3 py-2 font-semibold text-[#0f62af]">{key}</td>
                        <td className="px-3 py-2 break-all">{renderPayloadValue(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded border border-[#dddbda]">
              <div className="border-b border-[#f3f2f1] bg-[#f8f8f7] px-3 py-2 text-sm font-semibold text-[#3e3e3c]">Request Context</div>
              <div className="p-3 text-sm text-[#2f2f2f]">
                <div className="mb-2"><span className="font-semibold">Referrer:</span> {requestContext ? renderPayloadValue(requestContext.referer) : '--'}</div>
                <div className="mb-2"><span className="font-semibold">User Agent:</span> {requestContext ? renderPayloadValue(requestContext.user_agent) : '--'}</div>

                <div className="mb-1 font-semibold text-[#3e3e3c]">Request Query</div>
                {requestQuery.length === 0 ? (
                  <div className="mb-3 text-[#6a6a6a]">No request query values captured.</div>
                ) : (
                  <ul className="mb-3 list-disc pl-5">
                    {requestQuery.map(([key, value]) => (
                      <li key={`rq-${key}`}>
                        {key}: {renderPayloadValue(value)}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mb-1 font-semibold text-[#3e3e3c]">Referrer Query</div>
                {refererQuery.length === 0 ? (
                  <div className="text-[#6a6a6a]">No referrer query values captured.</div>
                ) : (
                  <ul className="list-disc pl-5">
                    {refererQuery.map(([key, value]) => (
                      <li key={`ref-${key}`}>
                        {key}: {renderPayloadValue(value)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
