"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Certificate {
  id: string;
  policy_id: string;
  client_id: string;
  certificate_holder: string;
  description?: string | null;
  issue_date: string;
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

interface NewCertificateForm {
  policy_id: string;
  client_id: string;
  certificate_holder: string;
  description: string;
  issue_date: string;
  status: 'issued';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CertificatesPage(): JSX.Element {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewCertificate, setShowNewCertificate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState<Certificate | null>(null);
  const [newCertificate, setNewCertificate] = useState<NewCertificateForm>({
    policy_id: '',
    client_id: '',
    certificate_holder: '',
    description: '',
    issue_date: todayISO(),
    status: 'issued',
  });

  const fetchCertificates = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/certificates', { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load certificates.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as Certificate[];
    setCertificates(data);
    setLoading(false);
  };

  const fetchPolicies = async (): Promise<void> => {
    const res = await fetch('/api/policies', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as PolicyOption[];
    setPolicies(data);
  };

  useEffect(() => {
    void fetchCertificates();
    void fetchPolicies();
  }, []);

  const handleCreateCertificate = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCertificate),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create certificate.' }))) as {
        message?: string;
      };
      setError(payload.message ?? 'Failed to create certificate.');
      setIsCreating(false);
      return;
    }

    setShowNewCertificate(false);
    setIsCreating(false);
    setNewCertificate({
      policy_id: '',
      client_id: '',
      certificate_holder: '',
      description: '',
      issue_date: todayISO(),
      status: 'issued',
    });
    await fetchCertificates();
  };

  const handleUpdateCertificate = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingCertificate) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/certificates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingCertificate.id,
        policy_id: editingCertificate.policy_id,
        client_id: editingCertificate.client_id,
        certificate_holder: editingCertificate.certificate_holder,
        description: editingCertificate.description || '',
        issue_date: editingCertificate.issue_date,
        status: editingCertificate.status,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update certificate.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update certificate.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingCertificate(null);
    await fetchCertificates();
  };

  const handleRemoveCertificate = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this certificate record?');
    if (!confirmed) return;

    const res = await fetch('/api/certificates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove certificate.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove certificate.');
      return;
    }

    await fetchCertificates();
  };

  return (
    <SectionLayout title="Certificates">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Certificates and COIs tied to policy and client records.</p>
        <button
          type="button"
          onClick={() => setShowNewCertificate(true)}
          className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
        >
          + New Certificate
        </button>
      </div>
      <p className="mb-3 text-xs font-semibold text-[#c23934]">Remove can be used to clear bad PDF/Excel-imported certificate rows.</p>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading certificates...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {certificates.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No certificates found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Insured</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">Certificate Holder</th>
                  <th className="px-3 py-2">Issue Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((certificate) => (
                  <tr key={certificate.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">
                      {certificate.policies?.insured_name ?? certificate.clients?.full_name ?? '--'}
                    </td>
                    <td className="px-3 py-2">{certificate.policies?.carrier ?? '--'}</td>
                    <td className="px-3 py-2">{certificate.certificate_holder}</td>
                    <td className="px-3 py-2">{certificate.issue_date}</td>
                    <td className="px-3 py-2">{certificate.status}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        type="button"
                        className="mr-2 font-semibold text-[#0f62af] hover:underline"
                        onClick={() => setEditingCertificate(certificate)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="font-semibold text-[#c23934] hover:underline"
                        onClick={() => void handleRemoveCertificate(certificate.id)}
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

      {showNewCertificate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">New Certificate</h2>

            <form onSubmit={handleCreateCertificate} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newCertificate.policy_id}
                onChange={(e) => {
                  const selected = policies.find((policy) => policy.id === e.target.value);
                  setNewCertificate((prev) => ({
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

              <input
                required
                type="text"
                placeholder="Certificate Holder"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newCertificate.certificate_holder}
                onChange={(e) => setNewCertificate((prev) => ({ ...prev, certificate_holder: e.target.value }))}
              />

              <textarea
                placeholder="Description"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newCertificate.description}
                onChange={(e) => setNewCertificate((prev) => ({ ...prev, description: e.target.value }))}
              />

              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={newCertificate.issue_date}
                onChange={(e) => setNewCertificate((prev) => ({ ...prev, issue_date: e.target.value }))}
              />

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isCreating ? 'Saving Certificate...' : 'Save Certificate'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewCertificate(false)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingCertificate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#080707]">Edit Certificate</h2>

            <form onSubmit={handleUpdateCertificate} className="space-y-2">
              <select
                required
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingCertificate.policy_id}
                onChange={(e) =>
                  setEditingCertificate((prev) => {
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
                required
                type="text"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingCertificate.certificate_holder}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, certificate_holder: e.target.value } : prev))}
              />
              <textarea
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingCertificate.description || ''}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
              <input
                required
                type="date"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingCertificate.issue_date}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, issue_date: e.target.value } : prev))}
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingCertificate.status}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                <option value="issued">Issued</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
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
                onClick={() => setEditingCertificate(null)}
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
