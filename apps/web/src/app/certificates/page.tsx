"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Certificate {
  id: string;
  policy_id: string;
  client_id: string;
  certificate_holder: string;
  description?: string | null;
  requested_at: string;
  requested_for: string | null;
  issue_date: string | null;
  document_id: string | null;
  version: number;
  status: string;
  delivery_reported_at: string | null;
  delivery_method: string | null;
  delivery_reference: string | null;
  created_at: string;
  policies?: { insured_name?: string; carrier?: string } | null;
  clients?: { full_name?: string } | null;
  events?: CertificateEvent[];
}

interface CertificateEvent {
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

interface AccountDocumentOption {
  id: string;
  file_name: string;
  status: string;
  source_kind: string;
  download_url: string | null;
}

interface NewCertificateForm {
  policy_id: string;
  client_id: string;
  certificate_holder: string;
  description: string;
  requested_for: string;
}

function statusLabel(status: string): string {
  if (status === 'in_review') return 'In review';
  if (status === 'delivery_reported') return 'Delivery reported';
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');
}

export default function CertificatesPage(): JSX.Element {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [accountDocuments, setAccountDocuments] = useState<AccountDocumentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewCertificate, setShowNewCertificate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState<Certificate | null>(null);
  const [historyCertificateId, setHistoryCertificateId] = useState<string | null>(null);
  const [newCertificate, setNewCertificate] = useState<NewCertificateForm>({
    policy_id: '',
    client_id: '',
    certificate_holder: '',
    description: '',
    requested_for: '',
  });

  const fetchCertificates = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/certificates', { cache: 'no-store' });
    if (!res.ok) {
      setError('Certificates could not be loaded. Refresh the page to try again.');
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

  const fetchAccountDocuments = async (accountId: string): Promise<void> => {
    setAccountDocuments([]);
    const res = await fetch(`/api/clients/${accountId}/files`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Account documents could not be loaded. Upload the certificate in Documents, then retry.');
      return;
    }
    const data = (await res.json()) as AccountDocumentOption[];
    setAccountDocuments(data.filter((file) => file.status === 'stored' && file.source_kind === 'stored' && file.download_url));
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
      const payload = (await res.json().catch(() => ({ message: 'Certificate could not be created. Please try again.' }))) as {
        message?: string;
      };
      setError(payload.message ?? 'Certificate could not be created. Please try again.');
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
      requested_for: '',
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
        version: editingCertificate.version,
        policy_id: editingCertificate.policy_id,
        client_id: editingCertificate.client_id,
        certificate_holder: editingCertificate.certificate_holder,
        description: editingCertificate.description || '',
        requested_for: editingCertificate.requested_for || null,
        issue_date: editingCertificate.issue_date,
        document_id: editingCertificate.document_id,
        status: editingCertificate.status,
        delivery_method: editingCertificate.delivery_method,
        delivery_reference: editingCertificate.delivery_reference,
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Certificate could not be updated. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Certificate could not be updated. Please try again.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingCertificate(null);
    await fetchCertificates();
  };

  const handleRemoveCertificate = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Cancel this certificate request? Its history will be retained.');
    if (!confirmed) return;

    const res = await fetch('/api/certificates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Certificate could not be removed. Please try again.' }))) as { message?: string };
      setError(payload.message ?? 'Certificate could not be removed. Please try again.');
      return;
    }

    await fetchCertificates();
  };

  return (
    <SectionLayout title="Certificates">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-cui-muted">Request, review, issue and report certificate delivery.</p>
        <button
          type="button"
          onClick={() => setShowNewCertificate(true)}
          className="rounded-lg border border-cui-primary-hover bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover"
        >
          + Request Certificate
        </button>
      </div>
      <p className="mb-3 text-xs text-cui-muted">Upload the certificate to account Documents before issuing it.</p>

      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-cui-muted">Loading certificates...</div> : null}

      {!loading ? (
        <div className="rounded-lg border border-cui-border bg-white shadow-sm">
          {certificates.length === 0 ? (
            <div className="p-4 text-sm text-cui-muted">No certificates found.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-cui-light text-cui-muted">
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
                  <React.Fragment key={certificate.id}>
                  <tr className="border-t border-cui-light">
                    <td className="px-3 py-2 font-semibold text-cui-primary-strong">
                      {certificate.policies?.insured_name ?? certificate.clients?.full_name ?? '--'}
                    </td>
                    <td className="px-3 py-2">{certificate.policies?.carrier ?? '--'}</td>
                    <td className="px-3 py-2">{certificate.certificate_holder}</td>
                    <td className="px-3 py-2">{certificate.issue_date ?? 'Not issued'}</td>
                    <td className="px-3 py-2">{statusLabel(certificate.status)}</td>
                    <td className="px-3 py-2 text-xs">
                      <button
                        type="button"
                        className="mr-2 font-semibold text-cui-primary-strong hover:underline"
                        onClick={() => {
                          setEditingCertificate(certificate);
                          void fetchAccountDocuments(certificate.client_id);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="mr-2 font-semibold text-cui-primary-strong hover:underline"
                        onClick={() => setHistoryCertificateId(historyCertificateId === certificate.id ? null : certificate.id)}
                      >
                        History ({certificate.events?.length ?? 0})
                      </button>
                      <button
                        type="button"
                        className="font-semibold text-[#c23934] hover:underline"
                        onClick={() => void handleRemoveCertificate(certificate.id)}
                        disabled={['issued', 'delivery_reported'].includes(certificate.status)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                  {historyCertificateId === certificate.id ? (
                    <tr className="border-t border-cui-light bg-cui-light">
                      <td colSpan={6} className="px-4 py-3">
                        {certificate.events?.length ? (
                          <ol className="space-y-2">
                            {certificate.events.map((event) => (
                              <li key={event.id} className="text-xs text-cui-muted">
                                <span className="font-semibold">{event.event_type.replaceAll('_', ' ')}</span>
                                {event.from_status ? `: ${statusLabel(event.from_status)} to ${statusLabel(event.to_status)}` : `: ${statusLabel(event.to_status)}`}
                                {' - '}{new Date(event.created_at).toLocaleString()}
                                {typeof event.snapshot.delivery_reference === 'string' ? ` - Reference ${event.snapshot.delivery_reference}` : ''}
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

      {showNewCertificate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-cui-text">Request Certificate</h2>

            <form onSubmit={handleCreateCertificate} className="space-y-2">
              <select
                required
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={newCertificate.certificate_holder}
                onChange={(e) => setNewCertificate((prev) => ({ ...prev, certificate_holder: e.target.value }))}
              />

              <textarea
                placeholder="Description"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={newCertificate.description}
                onChange={(e) => setNewCertificate((prev) => ({ ...prev, description: e.target.value }))}
              />

              <label className="block text-xs text-cui-muted">
                Date needed (optional)
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                  value={newCertificate.requested_for}
                  onChange={(e) => setNewCertificate((prev) => ({ ...prev, requested_for: e.target.value }))}
                />
              </label>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover disabled:opacity-60"
              >
                {isCreating ? 'Creating Request...' : 'Create Request'}
              </button>

              <button
                type="button"
                onClick={() => setShowNewCertificate(false)}
                className="w-full rounded-lg bg-cui-body px-3 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {editingCertificate ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-cui-text">Edit Certificate</h2>

            <form onSubmit={handleUpdateCertificate} className="space-y-2">
              <select
                required
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingCertificate.certificate_holder}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, certificate_holder: e.target.value } : prev))}
              />
              <textarea
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingCertificate.description || ''}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
              <input
                type="date"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                aria-label="Date needed"
                value={editingCertificate.requested_for ?? ''}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, requested_for: e.target.value || null } : prev))}
              />
              <select
                aria-label="Certificate status"
                className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                value={editingCertificate.status}
                onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                {!['requested', 'in_review', 'issued', 'delivery_reported', 'declined', 'cancelled'].includes(editingCertificate.status)
                  ? <option value={editingCertificate.status}>{statusLabel(editingCertificate.status)} (legacy)</option>
                  : null}
                <option value="requested">Requested</option>
                <option value="in_review">In review</option>
                <option value="issued">Issued</option>
                <option value="delivery_reported">Delivery reported</option>
                <option value="declined">Declined</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {['issued', 'delivery_reported'].includes(editingCertificate.status) ? (
                <>
                  <label className="block text-xs text-cui-muted">
                    Actual issue date
                    <input
                      required
                      type="date"
                      className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                      value={editingCertificate.issue_date ?? ''}
                      onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, issue_date: e.target.value || null } : prev))}
                    />
                  </label>
                  <label className="block text-xs text-cui-muted">
                    Uploaded certificate document
                    <select
                      required
                      className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                      value={editingCertificate.document_id ?? ''}
                      onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, document_id: e.target.value || null } : prev))}
                    >
                      <option value="">Select an uploaded private document</option>
                      {accountDocuments.map((file) => <option key={file.id} value={file.id}>{file.file_name}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-cui-muted">Upload the certificate in the account Documents tab first.</p>
                </>
              ) : null}
              {editingCertificate.status === 'delivery_reported' ? (
                <>
                  <label className="block text-xs text-cui-muted">
                    Delivery method
                    <select
                      required
                      className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                      value={editingCertificate.delivery_method ?? ''}
                      onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, delivery_method: e.target.value } : prev))}
                    >
                      <option value="">Select method</option>
                      <option value="email">Email</option>
                      <option value="portal">Carrier or client portal</option>
                      <option value="hand_delivery">Hand delivery</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <input
                    aria-label="Delivery reference (optional)"
                    placeholder="Delivery reference (optional)"
                    className="w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                    value={editingCertificate.delivery_reference ?? ''}
                    onChange={(e) => setEditingCertificate((prev) => (prev ? { ...prev, delivery_reference: e.target.value } : prev))}
                  />
                </>
              ) : null}
              <button
                type="submit"
                disabled={isSavingEdit}
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover disabled:opacity-60"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>

              <button
                type="button"
                onClick={() => setEditingCertificate(null)}
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
