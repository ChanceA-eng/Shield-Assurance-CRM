'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../components/crm/SectionLayout';
import NewLeadModal from './NewLeadModal';

interface Lead {
  id: string;
  full_name: string;
  industry?: string | null;
  category?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source: string;
  line_of_business: string;
  status: string;
  created_at: string;
  website?: string | null;
  est_employees?: string | null;
  est_revenue?: string | null;
  risk_exposure?: string | null;
  form_payload?: Record<string, unknown> | null;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
}

interface NewLeadForm {
  full_name: string;
  phone: string;
  email: string;
  line_of_business: string;
  source: string;
  status: 'new';
}

interface Interaction {
  id: string;
  lead_id: string;
  content: string;
  follow_up_at: string | null;
  follow_up_completed: boolean;
  created_at: string;
}

type PipelineFilter = 'all' | 'prospects' | 'leads';

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

function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getLeadPendingCount(lead: Lead): number {
  const lastViewedAt = parseDateOrNull(lead.last_viewed_at);
  const lastActivityAt = parseDateOrNull(lead.last_activity_at) ?? parseDateOrNull(lead.created_at);

  let count = 0;

  if (!lastViewedAt) {
    count += 1;
  } else {
    if (lastActivityAt && lastActivityAt.getTime() > lastViewedAt.getTime()) {
      count += 1;
    }

    if (lastViewedAt.getTime() <= Date.now() - 24 * 60 * 60 * 1000) {
      count += 1;
    }
  }

  return count;
}

export default function LeadsPage(): JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('all');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [interactionNote, setInteractionNote] = useState('');
  const [interactionFollowUpAt, setInteractionFollowUpAt] = useState('');
  const [interactionDrafts, setInteractionDrafts] = useState<Record<string, string>>({});
  const [isLoadingInteractions, setIsLoadingInteractions] = useState(false);
  const [isSavingInteraction, setIsSavingInteraction] = useState(false);
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

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const isProspect = (lead: Lead): boolean => {
    const source = lead.source?.toLowerCase() ?? '';
    return source.includes('prospect');
  };

  const filteredLeads = leads.filter((lead) => {
    if (pipelineFilter === 'prospects') {
      return isProspect(lead);
    }

    if (pipelineFilter === 'leads') {
      return !isProspect(lead);
    }

    return true;
  });

  const prospectCount = leads.filter((lead) => isProspect(lead)).length;
  const leadCount = leads.length - prospectCount;

  const toDateTimeLocalValue = (iso: string | null): string => {
    if (!iso) {
      return '';
    }

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const fromDateTimeLocalValue = (value: string): string | null => {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  };

  const openLeadDetails = (lead: Lead): void => {
    setSelectedLead(lead);
  };

  const fetchInteractions = async (leadId: string): Promise<void> => {
    setIsLoadingInteractions(true);
    try {
      const response = await fetch(`/api/interactions?leadId=${encodeURIComponent(leadId)}`, { cache: 'no-store' });
      if (!response.ok) {
        setInteractions([]);
        return;
      }

      const items = (await response.json()) as Interaction[];
      setInteractions(items);
      setInteractionDrafts(
        Object.fromEntries(
          items.map((item) => [item.id, toDateTimeLocalValue(item.follow_up_at)]),
        ),
      );
    } catch {
      setInteractions([]);
    } finally {
      setIsLoadingInteractions(false);
    }
  };

  useEffect(() => {
    if (!selectedLead) {
      setInteractions([]);
      setInteractionNote('');
      setInteractionFollowUpAt('');
      setInteractionDrafts({});
      return;
    }

    void fetchInteractions(selectedLead.id);
  }, [selectedLead]);

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

  const handleProspectUpload = async (file: File): Promise<void> => {
    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/leads/upload', {
        method: 'POST',
        body: formData,
      });

      const payload = (await res.json().catch(() => ({}))) as { success?: boolean; count?: number; message?: string };
      if (!res.ok || !payload.success) {
        setError(payload.message ?? 'Failed to import prospects.');
        return;
      }

      window.alert(`Successfully imported ${payload.count ?? 0} prospects.`);
      await fetchLeads();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleProspectUpload(file);
    event.target.value = '';
  };

  const handleSaveInteraction = async (): Promise<void> => {
    if (!selectedLead || !interactionNote.trim()) {
      return;
    }

    setIsSavingInteraction(true);
    try {
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          content: interactionNote,
          follow_up_at: fromDateTimeLocalValue(interactionFollowUpAt),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to save follow-up.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to save follow-up.');
        return;
      }

      setInteractionNote('');
      setInteractionFollowUpAt('');
      await fetchInteractions(selectedLead.id);
    } catch {
      setError('Failed to save follow-up.');
    } finally {
      setIsSavingInteraction(false);
    }
  };

  const handleUpdateInteraction = async (interactionId: string, patch: Record<string, unknown>): Promise<void> => {
    if (!selectedLead) {
      return;
    }

    setIsSavingInteraction(true);
    try {
      const response = await fetch('/api/interactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: interactionId, ...patch }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to update follow-up.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to update follow-up.');
        return;
      }

      await fetchInteractions(selectedLead.id);
    } catch {
      setError('Failed to update follow-up.');
    } finally {
      setIsSavingInteraction(false);
    }
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
        <div className="flex items-center gap-2">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragOver(false);
              const droppedFile = event.dataTransfer.files?.[0];
              if (droppedFile) {
                void handleProspectUpload(droppedFile);
              }
            }}
            className={`rounded border px-3 py-2 text-xs font-semibold transition ${
              isDragOver
                ? 'border-[#0f62af] bg-[#e7f3ff] text-[#0f62af]'
                : 'border-[#a8d4ff] bg-[#f5fbff] text-[#0f62af] hover:bg-[#e7f3ff]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => {
                void handleFileInputChange(event);
              }}
            />
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? 'Processing Import...' : 'Drop CSV/Excel/PDF to Bulk Import'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowNewLead(true)}
            className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
          >
            + New Lead
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPipelineFilter('all')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'all' ? 'border-[#0f62af] bg-[#0f62af] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          All Active ({leads.length})
        </button>
        <button
          type="button"
          onClick={() => setPipelineFilter('prospects')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'prospects' ? 'border-[#0f62af] bg-[#0f62af] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          Prospects ({prospectCount})
        </button>
        <button
          type="button"
          onClick={() => setPipelineFilter('leads')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'leads' ? 'border-[#0f62af] bg-[#0f62af] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          Leads ({leadCount})
        </button>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="text-sm text-[#6a6a6a]">Loading leads...</div> : null}

      {!loading ? (
        <div className="overflow-x-auto rounded border border-[#dddbda] bg-white shadow-sm">
          {filteredLeads.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No leads found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Industry</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">Line of Business</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Website</th>
                  <th className="px-3 py-2">Est. Employees</th>
                  <th className="px-3 py-2">Est. Revenue</th>
                  <th className="px-3 py-2">Risk Exposure</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">
                      {(() => {
                        const pendingCount = getLeadPendingCount(lead);
                        return (
                      <div className="flex items-center gap-2">
                        <Link href={`/clients/workspace?lead=${lead.id}`} className="hover:underline">
                          {lead.full_name}
                        </Link>
                        {pendingCount > 0 ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
                            {pendingCount > 9 ? '9+' : pendingCount}
                          </span>
                        ) : null}
                      </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">{lead.industry || '--'}</td>
                    <td className="px-3 py-2">{lead.category || '--'}</td>
                    <td className="px-3 py-2">{lead.phone || '--'}</td>
                    <td className="px-3 py-2">{lead.email || '--'}</td>
                    <td className="px-3 py-2">{lead.address || '--'}</td>
                    <td className="px-3 py-2">{lead.line_of_business}</td>
                    <td className="px-3 py-2">{lead.source}</td>
                    <td className="px-3 py-2">{lead.status}</td>
                    <td className="px-3 py-2">{lead.website || '--'}</td>
                    <td className="px-3 py-2">{lead.est_employees || '--'}</td>
                    <td className="px-3 py-2">{lead.est_revenue || '--'}</td>
                    <td className="max-w-60 px-3 py-2">{lead.risk_exposure || '--'}</td>
                    <td className="px-3 py-2">{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        type="button"
                        className="mr-2 font-semibold text-[#1f3f5b] hover:underline"
                        onClick={() => openLeadDetails(lead)}
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

            <div className="mb-4 rounded border border-[#dddbda]">
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

            <div className="rounded border border-[#dddbda]">
              <div className="border-b border-[#f3f2f1] bg-[#f8f8f7] px-3 py-2 text-sm font-semibold text-[#3e3e3c]">
                Conversation and Follow-Up Tracker
              </div>
              <div className="p-3">
                <textarea
                  value={interactionNote}
                  onChange={(event) => setInteractionNote(event.target.value)}
                  placeholder="Log the latest call summary, objection notes, or underwriting context."
                  className="mb-2 min-h-24 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                />
                <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#3e3e3c]">Next Follow-Up Target (optional)</label>
                    <input
                      type="datetime-local"
                      value={interactionFollowUpAt}
                      onChange={(event) => setInteractionFollowUpAt(event.target.value)}
                      className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveInteraction();
                    }}
                    disabled={isSavingInteraction || interactionNote.trim().length === 0}
                    className="rounded bg-[#0f62af] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {isSavingInteraction ? 'Saving...' : 'Log Interaction'}
                  </button>
                </div>

                <div className="rounded border border-[#edf1f5]">
                  <div className="border-b border-[#edf1f5] bg-[#fbfcfe] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#486987]">
                    Scheduled Follow-Ups
                  </div>
                  {isLoadingInteractions ? <div className="p-3 text-sm text-[#6a6a6a]">Loading follow-ups...</div> : null}
                  {!isLoadingInteractions && interactions.length === 0 ? (
                    <div className="p-3 text-sm text-[#6a6a6a]">No interactions logged yet.</div>
                  ) : null}
                  {!isLoadingInteractions && interactions.length > 0 ? (
                    <div className="max-h-72 overflow-y-auto">
                      {interactions.map((item) => (
                        <div key={item.id} className="border-b border-[#f2f5f8] px-3 py-3 last:border-b-0">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-[#20476e]">
                              {item.follow_up_completed ? 'Completed' : 'Open'} follow-up
                            </p>
                            <p className="text-xs text-[#6a6a6a]">{new Date(item.created_at).toLocaleString()}</p>
                          </div>
                          <p className="mb-2 text-sm text-[#2f2f2f]">{item.content}</p>
                          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                            <div>
                              <label className="mb-1 block text-xs font-semibold text-[#3e3e3c]">Reschedule</label>
                              <input
                                type="datetime-local"
                                value={interactionDrafts[item.id] ?? ''}
                                onChange={(event) =>
                                  setInteractionDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                void handleUpdateInteraction(item.id, {
                                  follow_up_at: fromDateTimeLocalValue(interactionDrafts[item.id] ?? ''),
                                  follow_up_completed: false,
                                });
                              }}
                              disabled={isSavingInteraction}
                              className="rounded border border-[#b8d4ec] bg-[#eef6fd] px-3 py-2 text-xs font-semibold text-[#0f62af] disabled:opacity-60"
                            >
                              Save Date
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handleUpdateInteraction(item.id, {
                                  follow_up_completed: !item.follow_up_completed,
                                });
                              }}
                              disabled={isSavingInteraction}
                              className="rounded border border-[#d1d5db] bg-white px-3 py-2 text-xs font-semibold text-[#334155] disabled:opacity-60"
                            >
                              {item.follow_up_completed ? 'Mark Open' : 'Mark Complete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
