'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { isRecord } from '../../lib/workspace-validation';
import ServiceRequestDocuments from './ServiceRequestDocuments';
import {
  canTransitionPolicyServiceRequest,
  POLICY_SERVICE_REQUEST_STATUSES,
  POLICY_SERVICE_REQUEST_TYPES,
  type PolicyServiceRequestStatus,
  type PolicyServiceRequestType,
} from '../../lib/policy-service-requests';

interface PolicyChoice {
  id: string;
  carrier?: string | null;
  policy_number?: string | null;
  line_of_business?: string | null;
}

interface ServiceRequestEvent {
  id: string;
  event_type: 'created' | 'updated' | 'status_changed';
  from_status: string | null;
  to_status: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

interface ServiceRequest {
  id: string;
  policy_id: string;
  description: string;
  status: string;
  request_type: string;
  requested_effective_date: string | null;
  carrier_submitted_at: string | null;
  carrier_confirmed_on: string | null;
  confirmation_reference: string | null;
  assigned_to: string | null;
  assigned_email: string | null;
  version: number;
  policies: { carrier: string; policy_number: string | null; line_of_business: string };
  events: ServiceRequestEvent[];
  task: { id: string; status: string } | null;
}

interface AgencyMember {
  user_id: string;
  email: string;
  active: boolean;
}

function isAgencyMember(value: unknown): value is AgencyMember {
  return isRecord(value) && typeof value.user_id === 'string'
    && typeof value.email === 'string' && typeof value.active === 'boolean';
}

const TYPE_LABELS: Record<PolicyServiceRequestType, string> = {
  address_change: 'Address change',
  name_change: 'Name change',
  vehicle_addition: 'Add a vehicle',
  vehicle_removal: 'Remove a vehicle',
  property_addition: 'Add a property',
  property_removal: 'Remove a property',
  endorsement: 'Other endorsement',
  certificate: 'Certificate request',
  cancellation: 'Cancellation',
  rewrite: 'Rewrite',
  other: 'Other service request',
};

const STATUS_LABELS: Record<PolicyServiceRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  waiting_on_carrier: 'Waiting on carrier',
  waiting_on_client: 'Waiting on client',
  confirmed: 'Carrier confirmed',
  closed: 'Closed',
  cancelled: 'Cancelled',
  reopened: 'Reopened',
};

function isRequest(value: unknown): value is ServiceRequest {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.policy_id !== 'string'
    || typeof value.version !== 'number' || typeof value.description !== 'string'
    || typeof value.status !== 'string' || typeof value.request_type !== 'string'
    || !isRecord(value.policies) || typeof value.policies.carrier !== 'string'
    || typeof value.policies.line_of_business !== 'string' || !Array.isArray(value.events)) return false;
  return value.events.every((event) => isRecord(event) && typeof event.id === 'string'
    && typeof event.event_type === 'string' && typeof event.to_status === 'string'
    && isRecord(event.snapshot) && typeof event.created_at === 'string');
}

function RequestCard({ request, focus, onStatus, members, accountId, onOwner }: {
  request: ServiceRequest;
  focus: boolean;
  onStatus: (request: ServiceRequest, status: PolicyServiceRequestStatus, confirmedOn?: string, reference?: string) => Promise<void>;
  members: AgencyMember[];
  accountId: string;
  onOwner: (request: ServiceRequest, ownerId: string | null) => Promise<void>;
}): JSX.Element {
  const [confirmedOn, setConfirmedOn] = useState(request.carrier_confirmed_on ?? '');
  const [reference, setReference] = useState(request.confirmation_reference ?? '');
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);
  const [error, setError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const nextStatuses = POLICY_SERVICE_REQUEST_STATUSES.filter((status) =>
    canTransitionPolicyServiceRequest(request.status, status));

  const advance = async (status: PolicyServiceRequestStatus): Promise<void> => {
    setSavingStatus(true);
    setError('');
    try {
      await onStatus(request, status, confirmedOn || undefined, reference || undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The request could not be updated.');
    } finally {
      setSavingStatus(false);
    }
  };

  return <article id={`service-request-${request.id}`} className={`rounded-lg border p-3 ${focus ? 'border-cui-primary bg-sky-50' : 'border-cui-border bg-white'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h4 className="text-sm font-semibold text-cui-text">{TYPE_LABELS[request.request_type as PolicyServiceRequestType] ?? 'Service request'}</h4>
        <p className="text-xs text-cui-muted">{request.policies.carrier} · {request.policies.policy_number || 'No policy number'} · {request.policies.line_of_business}</p>
      </div>
      <span className="rounded bg-cui-light px-2 py-1 text-xs font-semibold">{STATUS_LABELS[request.status as PolicyServiceRequestStatus] ?? 'Processed (legacy)'}</span>
    </div>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{request.description}</p>
    {request.requested_effective_date ? <p className="mt-1 text-xs text-cui-muted">Requested effective date: {request.requested_effective_date}</p> : null}
    {request.carrier_submitted_at ? <p className="mt-1 text-xs text-cui-muted">Submitted to carrier: {formatArizonaDateTime(request.carrier_submitted_at)} AZ</p> : null}
    {request.carrier_confirmed_on ? <p className="mt-1 text-xs text-cui-muted">Carrier confirmation reported {request.carrier_confirmed_on}: {request.confirmation_reference}</p> : null}
    <p className="mt-1 text-xs text-cui-muted">
      Follow-up task: {request.task ? request.task.status === 'open' ? 'Open' : 'Completed' : 'Not created; service task automation may be paused.'}
    </p>
    <label className="mt-2 block max-w-sm text-xs font-semibold text-cui-muted">Request owner
      <select aria-label={`Owner for ${request.policies.policy_number || 'service request'}`}
        disabled={savingOwner} value={request.assigned_to ?? ''}
        onChange={(event) => {
          setSavingOwner(true);
          setError('');
          void onOwner(request, event.target.value || null)
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'The owner could not be updated.'))
            .finally(() => setSavingOwner(false));
        }}
        className="mt-1 block w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
        <option value="">Unassigned</option>
        {request.assigned_to && !members.some((member) => member.user_id === request.assigned_to)
          ? <option value={request.assigned_to}>{request.assigned_email ?? 'Inactive member'}</option>
          : null}
        {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
      </select>
    </label>

    {nextStatuses.includes('confirmed') ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-semibold text-cui-muted">Carrier confirmation date
        <input type="date" value={confirmedOn} onChange={(event) => setConfirmedOn(event.target.value)}
          className="mt-1 block w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
      </label>
      <label className="text-xs font-semibold text-cui-muted">Carrier reference
        <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={500}
          className="mt-1 block w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
      </label>
    </div> : null}
    {nextStatuses.length ? <div className="mt-3 flex flex-wrap gap-2">
      {nextStatuses.map((status) => <button key={status} type="button" disabled={savingStatus}
        onClick={() => void advance(status)}
        className={`rounded border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${status === 'cancelled' ? 'border-cui-danger text-cui-danger' : 'border-cui-primary text-cui-primary hover:bg-sky-50'}`}>
        {status === 'reopened' ? 'Reopen' : `Move to ${STATUS_LABELS[status]}`}
      </button>)}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-cui-danger">{error}</p> : null}
    <ServiceRequestDocuments accountId={accountId} requestId={request.id} />
    {request.events.length ? <details className="mt-3 border-t border-cui-border pt-2">
      <summary className="cursor-pointer text-xs font-semibold text-cui-primary">History ({request.events.length})</summary>
      <ol className="mt-2 space-y-2">
        {request.events.map((event) => <li key={event.id} className="border-l-2 border-cui-border pl-2 text-xs">
          <span className="font-semibold">{event.event_type === 'status_changed'
            ? `${STATUS_LABELS[event.from_status as PolicyServiceRequestStatus] ?? event.from_status} → ${STATUS_LABELS[event.to_status as PolicyServiceRequestStatus] ?? event.to_status}`
            : event.event_type === 'created' ? 'Request created' : 'Request details updated'}</span>
          <span className="ml-2 text-cui-muted">{formatArizonaDateTime(event.created_at)} AZ</span>
          {typeof event.snapshot.description === 'string' ? <p className="mt-1 whitespace-pre-wrap text-cui-muted">{event.snapshot.description}</p> : null}
        </li>)}
      </ol>
    </details> : null}
  </article>;
}

export default function PolicyServiceRequests({ accountId, policies, focusRequestId }: {
  accountId: string;
  policies: PolicyChoice[];
  focusRequestId: string | null;
}): JSX.Element {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [requestType, setRequestType] = useState<PolicyServiceRequestType>('other');
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [members, setMembers] = useState<AgencyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const payload = await workspaceFetch<unknown>(`/api/policy-change-requests?account_id=${encodeURIComponent(accountId)}`);
      if (!Array.isArray(payload) || !payload.every(isRequest)) throw new Error('The service request response was invalid.');
      setRequests(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Service requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void workspaceFetch<unknown>(`/api/agency/assignment?record_type=client&record_id=${encodeURIComponent(accountId)}`)
      .then((payload) => {
        if (!active) return;
        if (payload === null) return;
        if (!isRecord(payload) || !Array.isArray(payload.members) || !payload.members.every(isAgencyMember)) {
          throw new Error('The agency member response was invalid.');
        }
        setMembers(payload.members);
      })
      .catch((failure: unknown) => {
        if (active) setOwnerError(failure instanceof Error ? failure.message : 'Request owners could not be loaded.');
      });
    return () => { active = false; };
  }, [accountId]);

  useEffect(() => {
    if (focusRequestId && requests.some((request) => request.id === focusRequestId)) {
      document.getElementById(`service-request-${focusRequestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusRequestId, requests]);

  const updateStatus = async (request: ServiceRequest, status: PolicyServiceRequestStatus, confirmedOn?: string, reference?: string): Promise<void> => {
    const saved = await workspaceFetch<unknown>('/api/policy-change-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: request.id, version: request.version, status,
        ...(status === 'confirmed' ? { carrier_confirmed_on: confirmedOn, confirmation_reference: reference } : {}),
      }),
    });
    if (!isRequest(saved)) throw new Error('The saved service request response was invalid.');
    await load();
  };

  const updateOwner = async (request: ServiceRequest, assignedTo: string | null): Promise<void> => {
    await workspaceFetch('/api/policy-change-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: request.id, version: request.version, assigned_to: assignedTo }),
    });
    await load();
  };

  const createRequest = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await workspaceFetch('/api/policy-change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId, policy_id: policyId, request_type: requestType,
          description, requested_effective_date: effectiveDate || null, assigned_to: ownerId || null,
        }),
      });
      setDescription('');
      setEffectiveDate('');
      setNotice('Service request saved. Its history and follow-up task are linked below.');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The service request could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <section aria-label="Policy servicing requests" className="mt-4 rounded-lg border border-cui-border bg-cui-body/40 p-4">
    <h3 className="text-sm font-semibold text-cui-text">Policy servicing</h3>
    {ownerError ? <p role="alert" className="mt-2 text-xs text-cui-danger">{ownerError}</p> : null}
    {policies.length ? <form onSubmit={(event) => void createRequest(event)} className="mt-3 grid gap-2 rounded border border-cui-border bg-white p-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-cui-muted">Policy
        <select value={policyId} onChange={(event) => setPolicyId(event.target.value)} required className="mt-1 block w-full rounded border border-cui-border px-2 py-2 text-sm text-cui-text">
          {policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.carrier || 'Carrier not recorded'} · {policy.policy_number || 'No policy number'} · {policy.line_of_business || 'Policy'}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-cui-muted">Request type
        <select value={requestType} onChange={(event) => setRequestType(event.target.value as PolicyServiceRequestType)} className="mt-1 block w-full rounded border border-cui-border px-2 py-2 text-sm text-cui-text">
          {POLICY_SERVICE_REQUEST_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-cui-muted">Requested effective date (optional)
        <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="mt-1 block w-full rounded border border-cui-border px-2 py-2 text-sm text-cui-text" />
      </label>
      <label className="text-xs font-semibold text-cui-muted">Request owner
        <select aria-label="New service request owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}
          className="mt-1 block w-full rounded border border-cui-border px-2 py-2 text-sm text-cui-text">
          <option value="">Assign to me</option>
          {members.filter((member) => member.active).map((member) => (
            <option key={member.user_id} value={member.user_id}>{member.email}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-cui-muted sm:col-span-2">What needs to change?
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={4000} rows={3}
          className="mt-1 block w-full rounded border border-cui-border px-2 py-2 text-sm text-cui-text" />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={saving || !policyId || !description.trim()} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Create servicing request'}
        </button>
      </div>
    </form> : <p className="mt-3 rounded border border-cui-border bg-white p-3 text-sm text-cui-muted">Record a policy term before creating a servicing request.</p>}
    {notice ? <p role="status" className="mt-2 text-sm text-cui-success">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-cui-danger">{error}<button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></p> : null}
    {loading ? <p role="status" className="mt-3 text-sm text-cui-muted">Loading service history…</p> : requests.length
      ? <div className="mt-3 space-y-3">{requests.map((request) => <RequestCard key={request.id} request={request}
        accountId={accountId} members={members.filter((member) => member.active)}
        focus={request.id === focusRequestId} onStatus={updateStatus} onOwner={updateOwner} />)}</div>
      : !error ? <p className="mt-3 text-sm text-cui-muted">No policy servicing requests recorded.</p> : null}
  </section>;
}
