"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';
import { isRenewalReviewStatus } from '../../lib/renewal-review';

type RenewalWindow = '30' | '60' | '90' | 'overdue';
type RenewalReviewStatus = 'in_review' | 'remarketing' | 'retained' | 'renewed' | 'non_renewed' | 'cancelled';

interface RenewalEvent {
  id: string;
  actor_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

interface RenewalReview {
  id: string;
  policy_id: string;
  account_id: string;
  renewal_term: string;
  status: RenewalReviewStatus;
  assigned_to: string | null;
  assigned_email: string | null;
  notes: string | null;
  follow_up_date: string | null;
  next_policy_id: string | null;
  version: number;
  events: RenewalEvent[];
}

interface RenewalPolicy {
  id: string;
  client_id: string;
  account_id: string;
  insured_name: string;
  carrier: string;
  line_of_business: string;
  premium: number | null;
  renewal_date: string | null;
  renewal_on: string;
  expiration_date: string | null;
  status: string;
  review: RenewalReview | null;
}

interface RenewalsResponse {
  window: RenewalWindow;
  counts: Record<RenewalWindow, number>;
  items: RenewalPolicy[];
}

interface PolicyOption {
  id: string;
  prior_policy_id: string | null;
  policy_number: string | null;
  insured_name: string;
}

interface AgencyMember {
  user_id: string;
  email: string;
  active: boolean;
}

interface ReviewFormState {
  policy: RenewalPolicy;
  reviewId: string | null;
  version: number | null;
  status: RenewalReviewStatus;
  assignedTo: string;
  notes: string;
  followUpDate: string;
  nextPolicyId: string;
}

const windows: Array<{ value: RenewalWindow; label: string }> = [
  { value: '30', label: '30 Days' },
  { value: '60', label: '60 Days' },
  { value: '90', label: '90 Days' },
  { value: 'overdue', label: 'Overdue' },
];

const reviewStatuses: Array<{ value: RenewalReviewStatus; label: string }> = [
  { value: 'in_review', label: 'In review' },
  { value: 'remarketing', label: 'Remarketing' },
  { value: 'retained', label: 'Retained' },
  { value: 'renewed', label: 'Renewed' },
  { value: 'non_renewed', label: 'Non-renewed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusLabel(status: string): string {
  return reviewStatuses.find((item) => item.value === status)?.label ?? status;
}

export default function RenewalsPage(): JSX.Element {
  const [selectedWindow, setSelectedWindow] = useState<RenewalWindow>('30');
  const [renewals, setRenewals] = useState<RenewalPolicy[]>([]);
  const [counts, setCounts] = useState<Record<RenewalWindow, number>>({
    '30': 0,
    '60': 0,
    '90': 0,
    overdue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewFormState | null>(null);
  const [policyOptions, setPolicyOptions] = useState<PolicyOption[]>([]);
  const [agencyMembers, setAgencyMembers] = useState<AgencyMember[]>([]);
  const [historyPolicyId, setHistoryPolicyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchRenewals = async (window: RenewalWindow): Promise<void> => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/renewals?window=${window}`, { cache: 'no-store' });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Renewals could not be loaded. Refresh the page to try again.' }))) as { message?: string };
      setError(payload.message ?? 'Renewals could not be loaded. Refresh the page to try again.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as RenewalsResponse;
    setRenewals(data.items ?? []);
    setCounts(data.counts);
    setLoading(false);
  };

  useEffect(() => {
    void fetchRenewals(selectedWindow);
  }, [selectedWindow]);

  const openReview = async (policy: RenewalPolicy): Promise<void> => {
    const review = policy.review;
    setReviewForm({
      policy,
      reviewId: review?.id ?? null,
      version: review?.version ?? null,
      status: review?.status ?? 'in_review',
      assignedTo: review?.assigned_to ?? '',
      notes: review?.notes ?? '',
      followUpDate: review?.follow_up_date ?? '',
      nextPolicyId: review?.next_policy_id ?? '',
    });
    setError(null);
    const [policyResponse, assignmentResponse] = await Promise.all([
      fetch(`/api/policies?account_id=${policy.client_id}`, { cache: 'no-store' }),
      fetch(`/api/agency/assignment?record_type=client&record_id=${policy.client_id}`, { cache: 'no-store' }),
    ]);
    if (!policyResponse.ok) {
      setError('Account policies could not be loaded. Refresh and retry.');
      return;
    }
    const policyData = (await policyResponse.json()) as PolicyOption[];
    setPolicyOptions(policyData.filter((item) => item.prior_policy_id === policy.id));
    if (!assignmentResponse.ok) {
      setError('Renewal owners could not be loaded. Refresh and retry.');
      return;
    }
    const assignmentData = (await assignmentResponse.json()) as { members?: AgencyMember[] } | null;
    setAgencyMembers((assignmentData?.members ?? []).filter((member) => member.active));
  };

  const saveReview = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!reviewForm) return;
    setIsSaving(true);
    setError(null);
    const isNew = reviewForm.reviewId === null;
    const payload = {
      ...(isNew
        ? { policy_id: reviewForm.policy.id, renewal_term: reviewForm.policy.renewal_on }
        : { id: reviewForm.reviewId, version: reviewForm.version }),
      status: reviewForm.status,
      assigned_to: reviewForm.assignedTo || null,
      notes: reviewForm.notes,
      follow_up_date: reviewForm.followUpDate || null,
      next_policy_id: reviewForm.status === 'renewed' ? reviewForm.nextPolicyId || null : null,
    };
    const res = await fetch('/api/renewals/reviews', {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const response = (await res.json().catch(() => ({ message: 'Renewal review could not be saved.' }))) as { message?: string };
      setError(response.message ?? 'Renewal review could not be saved.');
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setReviewForm(null);
    await fetchRenewals(selectedWindow);
  };

  return (
    <SectionLayout title="Renewals">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cui-muted">Review active policy terms, assign an owner and record the outcome.</p>
        <div className="flex flex-wrap gap-2">
          {windows.map((window) => (
            <button
              key={window.value}
              type="button"
              onClick={() => setSelectedWindow(window.value)}
              className={`rounded border px-3 py-2 text-sm font-semibold ${
                selectedWindow === window.value
                  ? 'border-cui-primary-hover bg-cui-primary-strong text-white'
                  : 'border-cui-border bg-white text-cui-muted hover:bg-cui-light'
              }`}
            >
              {window.label} ({counts[window.value] ?? 0})
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs text-cui-muted">Link the issued next term when marking a policy renewed.</p>
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-cui-muted">Loading renewals...</div> : null}

      {!loading ? (
        <div className="rounded-lg border border-cui-border bg-white shadow-sm">
          {renewals.length === 0 ? (
            <div className="p-4 text-sm text-cui-muted">No renewals found for this window.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-cui-light text-cui-muted">
                <tr>
                  <th className="px-3 py-2">Insured</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">LOB</th>
                  <th className="px-3 py-2">Premium</th>
                  <th className="px-3 py-2">Renewal / Expiration</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((policy) => (
                  <React.Fragment key={policy.id}>
                    <tr className="border-t border-cui-light">
                      <td className="px-3 py-2 font-semibold text-cui-primary-strong">{policy.insured_name}</td>
                      <td className="px-3 py-2">{policy.carrier}</td>
                      <td className="px-3 py-2">{policy.line_of_business}</td>
                      <td className="px-3 py-2">{policy.premium === null ? '--' : `$${policy.premium.toLocaleString()}`}</td>
                      <td className="px-3 py-2">{policy.renewal_on}</td>
                      <td className="px-3 py-2">{policy.review ? statusLabel(policy.review.status) : 'Not started'}</td>
                      <td className="px-3 py-2 text-xs">
                        <a className="mr-3 font-semibold text-cui-primary-strong hover:underline" href={`/clients/${policy.client_id}?tab=policies`}>
                          Account
                        </a>
                        <button type="button" className="mr-3 font-semibold text-cui-primary-strong hover:underline" onClick={() => void openReview(policy)}>
                          {policy.review ? 'Update review' : 'Start review'}
                        </button>
                        {policy.review ? (
                          <button
                            type="button"
                            className="font-semibold text-cui-primary-strong hover:underline"
                            onClick={() => setHistoryPolicyId(historyPolicyId === policy.id ? null : policy.id)}
                          >
                            History ({policy.review.events.length})
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {historyPolicyId === policy.id && policy.review ? (
                      <tr className="border-t border-cui-light bg-cui-light">
                        <td colSpan={7} className="px-4 py-3">
                          <ol className="space-y-2">
                            {policy.review.events.map((event) => (
                              <li key={event.id} className="text-xs text-cui-muted">
                                <span className="font-semibold">{event.event_type.replaceAll('_', ' ')}</span>
                                {event.from_status ? `: ${statusLabel(event.from_status)} to ${statusLabel(event.to_status)}` : `: ${statusLabel(event.to_status)}`}
                                {' - '}{new Date(event.created_at).toLocaleString()}
                                {typeof event.snapshot.notes === 'string' ? ` - ${event.snapshot.notes}` : ''}
                              </li>
                            ))}
                          </ol>
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

      {reviewForm ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-cui-border bg-white p-4 shadow-xl">
            <h2 className="mb-1 text-lg font-bold text-cui-text">Renewal review</h2>
            <p className="mb-3 text-xs text-cui-muted">{reviewForm.policy.insured_name} - {reviewForm.policy.renewal_on}</p>
            <form onSubmit={saveReview} className="space-y-3">
              <label className="block text-xs text-cui-muted">
                Outcome
                <select
                  required
                  className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                  value={reviewForm.status}
                  onChange={(event) => setReviewForm((previous) => {
                    if (!previous || !isRenewalReviewStatus(event.target.value)) return previous;
                    return { ...previous, status: event.target.value };
                  })}
                >
                  {reviewStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-cui-muted">
                Owner
                <select
                  className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                  value={reviewForm.assignedTo}
                  onChange={(event) => setReviewForm((previous) => previous ? { ...previous, assignedTo: event.target.value } : previous)}
                >
                  <option value="">Assign to me</option>
                  {reviewForm.policy.review?.assigned_to && !agencyMembers.some((member) => member.user_id === reviewForm.policy.review?.assigned_to)
                    ? <option value={reviewForm.policy.review.assigned_to}>{reviewForm.policy.review.assigned_email ?? 'Inactive member'}</option>
                    : null}
                  {agencyMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
                </select>
              </label>
              {reviewForm.status === 'renewed' ? (
                <label className="block text-xs text-cui-muted">
                  Linked issued next term
                  <select
                    required
                    className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                    value={reviewForm.nextPolicyId}
                    onChange={(event) => setReviewForm((previous) => previous ? { ...previous, nextPolicyId: event.target.value } : previous)}
                  >
                    <option value="">Select the issued renewal policy</option>
                    {policyOptions.map((policy) => (
                      <option key={policy.id} value={policy.id}>{policy.policy_number || policy.id} - {policy.insured_name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs text-cui-muted">
                Follow-up date (optional)
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                  value={reviewForm.followUpDate}
                  onChange={(event) => setReviewForm((previous) => previous ? { ...previous, followUpDate: event.target.value } : previous)}
                />
              </label>
              <label className="block text-xs text-cui-muted">
                Review notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-cui-border px-3 py-2 text-sm"
                  value={reviewForm.notes}
                  onChange={(event) => setReviewForm((previous) => previous ? { ...previous, notes: event.target.value } : previous)}
                />
              </label>
              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-lg bg-cui-primary-strong px-3 py-2 text-sm font-semibold text-white hover:bg-cui-primary-hover disabled:opacity-60"
              >
                {isSaving ? 'Saving review...' : 'Save review'}
              </button>
              <button
                type="button"
                onClick={() => setReviewForm(null)}
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
