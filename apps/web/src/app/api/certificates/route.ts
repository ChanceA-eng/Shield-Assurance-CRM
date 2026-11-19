import { NextRequest, NextResponse } from 'next/server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { processCertificateRequested } from '../../../lib/automation';
import { CLIENT_FILE_COLUMNS, storedLocation, type ClientFileRecord } from '../../../lib/account-documents';
import { canTransitionCertificateStatus, isCalendarDate, isCertificateStatus } from '../../../lib/certificate-lifecycle';
import { WorkspaceError } from '../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';

interface CertificatePayload {
  id?: unknown;
  version?: unknown;
  policy_id?: unknown;
  client_id?: unknown;
  account_id?: unknown;
  certificate_holder?: unknown;
  holder_name?: unknown;
  holder_address?: unknown;
  description?: unknown;
  requested_for?: unknown;
  issue_date?: unknown;
  document_id?: unknown;
  status?: unknown;
  delivery_method?: unknown;
  delivery_reference?: unknown;
}

interface CertificateRow {
  id: string;
  policy_id: string;
  client_id: string;
  account_id: string | null;
  certificate_holder: string;
  holder_name: string | null;
  holder_address: string | null;
  description: string | null;
  requested_at: string;
  requested_for: string | null;
  issue_date: string | null;
  document_id: string | null;
  status: string;
  version: number;
  created_at: string;
}

function optionalText(value: unknown, label: string, limit: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > limit) throw new WorkspaceError(`${label} must be ${limit} characters or fewer.`, 400);
  return value.trim() || null;
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new WorkspaceError(`${label} is required and must be ${limit} characters or fewer.`, 400);
  }
  return value.trim();
}

const certificateFields = 'id,policy_id,client_id,account_id,certificate_holder,holder_name,holder_address,description,requested_at,requested_for,issue_date,issued_date,expiration_date,coverage_summary,file_path,document_id,status,version,updated_by,reviewed_at,reviewed_by,issued_by,delivery_reported_at,delivery_method,delivery_reference,delivery_reported_by,created_at';

async function validateStoredDocument(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  documentId: string,
  accountId: string,
): Promise<void> {
  const { data, error } = await supabase.from('client_files')
    .select(CLIENT_FILE_COLUMNS).eq('id', documentId).eq('client_id', accountId).maybeSingle<ClientFileRecord>();
  if (error) throw databaseError(error);
  if (!data || data.status !== 'uploaded' || !storedLocation(data)) {
    throw new WorkspaceError('Choose an uploaded private account document. External links and unuploaded records cannot be issued as certificates.', 400);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const status = request.nextUrl.searchParams.get('status') ?? 'all';
    const accountId = request.nextUrl.searchParams.get('account_id');
    const policyId = request.nextUrl.searchParams.get('policy_id');
    if (accountId && !isUuid(accountId)) throw new WorkspaceError('Select a valid account.', 400);
    if (policyId && !isUuid(policyId)) throw new WorkspaceError('Select a valid policy.', 400);
    if (status !== 'all' && !isCertificateStatus(status)) throw new WorkspaceError('Choose a valid certificate status.', 400);

    let query = supabase.from('certificates').select(`${certificateFields},policies(insured_name,carrier)`)
      .order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') query = query.eq('status', status);
    if (accountId) query = query.eq('account_id', accountId);
    if (policyId) query = query.eq('policy_id', policyId);
    const { data, error } = await query;
    if (error) throw databaseError(error);
    const certificates = (data ?? []) as Array<CertificateRow & { policies: unknown }>;
    if (certificates.length === 0) return NextResponse.json([], { status: 200 });

    const { data: events, error: eventsError } = await supabase.from('certificate_record_events')
      .select('id,certificate_id,actor_id,event_type,from_status,to_status,snapshot,created_at')
      .in('certificate_id', certificates.map((certificate) => certificate.id))
      .order('created_at', { ascending: false });
    if (eventsError) throw databaseError(eventsError);
    const eventsByCertificate = new Map<string, NonNullable<typeof events>>();
    for (const event of events ?? []) {
      const current = eventsByCertificate.get(event.certificate_id) ?? [];
      current.push(event);
      eventsByCertificate.set(event.certificate_id, current);
    }

    return NextResponse.json(certificates.map((certificate) => ({
      ...certificate,
      events: eventsByCertificate.get(certificate.id) ?? [],
    })), { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'certificates');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as CertificatePayload;
    if (typeof payload.policy_id !== 'string' || !isUuid(payload.policy_id)) throw new WorkspaceError('Select a valid policy.', 400);
    const holder = requiredText(payload.holder_name ?? payload.certificate_holder, 'Certificate holder', 200);
    const requestedFor = optionalText(payload.requested_for, 'Date needed', 10);
    if (requestedFor && !isCalendarDate(requestedFor)) throw new WorkspaceError('Enter a valid date needed.', 400);
    const { data: policy, error: policyError } = await supabase.from('policies')
      .select('id,client_id,account_id').eq('id', payload.policy_id).maybeSingle();
    if (policyError) throw databaseError(policyError);
    if (!policy) throw new WorkspaceError('The selected policy could not be found.', 404);
    const clientId = policy.account_id ?? policy.client_id;
    if ((payload.account_id && payload.account_id !== clientId) || (payload.client_id && payload.client_id !== clientId)) {
      throw new WorkspaceError('The selected policy does not belong to that account.', 400);
    }

    const description = optionalText(payload.description, 'Coverage requested', 4000) ?? null;
    const { data, error } = await supabase.from('certificates').insert({
      policy_id: policy.id,
      client_id: clientId,
      account_id: clientId,
      certificate_holder: holder,
      holder_name: holder,
      description,
      coverage_summary: description,
      requested_for: requestedFor ?? null,
      status: 'requested',
      issue_date: null,
      issued_date: null,
      document_id: null,
      updated_by: session.user.id,
    }).select(certificateFields).single();
    if (error) throw databaseError(error);

    const { data: policyDetails } = await supabase.from('policies').select('insured_name').eq('id', policy.id).maybeSingle();
    await processCertificateRequested({
      clientId: data.client_id,
      insuredName: policyDetails?.insured_name ?? `Policy ${data.policy_id}`,
      certificateHolder: data.certificate_holder,
      actorName: apiActorName(session.user),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'certificates');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as CertificatePayload;
    if (typeof payload.id !== 'string' || !isUuid(payload.id)) throw new WorkspaceError('Select a valid certificate.', 400);
    if (!Number.isInteger(payload.version) || Number(payload.version) < 1) throw new WorkspaceError('Refresh the certificate before saving your changes.', 400);
    const { data: current, error: currentError } = await supabase.from('certificates')
      .select('id,policy_id,client_id,status,version,document_id,issue_date,delivery_method')
      .eq('id', payload.id).maybeSingle();
    if (currentError) throw databaseError(currentError);
    if (!current) throw new WorkspaceError('Certificate not found.', 404);
    if (current.version !== payload.version) throw new WorkspaceError('This certificate changed since it was opened. Refresh and retry.', 409);

    const updates: Record<string, string | null> = { updated_by: session.user.id };
    const policyId = typeof payload.policy_id === 'string' ? payload.policy_id : current.policy_id;
    if (!isUuid(policyId)) throw new WorkspaceError('Select a valid policy.', 400);
    if (policyId !== current.policy_id) {
      const { data: policy, error: policyError } = await supabase.from('policies')
        .select('id,client_id,account_id').eq('id', policyId).maybeSingle();
      if (policyError) throw databaseError(policyError);
      if (!policy || (policy.account_id ?? policy.client_id) !== current.client_id) {
        throw new WorkspaceError('A certificate can only be moved to another policy on the same account.', 400);
      }
      updates.policy_id = policyId;
    }

    const holder = optionalText(payload.holder_name ?? payload.certificate_holder, 'Certificate holder', 200);
    const address = optionalText(payload.holder_address, 'Holder address', 500);
    const description = optionalText(payload.description, 'Coverage requested', 4000);
    const requestedFor = optionalText(payload.requested_for, 'Date needed', 10);
    if (holder !== undefined) {
      if (!holder) throw new WorkspaceError('Certificate holder cannot be empty.', 400);
      updates.certificate_holder = holder;
      updates.holder_name = holder;
    }
    if (address !== undefined) updates.holder_address = address;
    if (description !== undefined) {
      updates.description = description;
      updates.coverage_summary = description;
    }
    if (requestedFor !== undefined) {
      if (requestedFor && !isCalendarDate(requestedFor)) throw new WorkspaceError('Enter a valid date needed.', 400);
      updates.requested_for = requestedFor;
    }

    const nextStatus = payload.status === undefined ? current.status : payload.status;
    if (typeof nextStatus !== 'string' || (isCertificateStatus(nextStatus) === false && nextStatus !== current.status)) {
      throw new WorkspaceError('Choose a valid certificate status.', 400);
    }
    if (nextStatus !== current.status) {
      if (!isCertificateStatus(nextStatus) || !canTransitionCertificateStatus(current.status, nextStatus)) {
        throw new WorkspaceError(`A ${current.status} certificate cannot move directly to ${String(nextStatus)}.`, 409);
      }
      updates.status = nextStatus;
    }

    const documentId = payload.document_id === undefined
      ? current.document_id
      : typeof payload.document_id === 'string' ? payload.document_id : null;
    if (payload.document_id !== undefined && payload.document_id !== null && typeof payload.document_id !== 'string') {
      throw new WorkspaceError('Choose a valid account document.', 400);
    }
    if (documentId && !isUuid(documentId)) throw new WorkspaceError('Choose a valid account document.', 400);
    if (payload.document_id !== undefined) updates.document_id = documentId;
    if (documentId) await validateStoredDocument(supabase, documentId, current.client_id);

    const issueDate = payload.issue_date === undefined ? current.issue_date : optionalText(payload.issue_date, 'Issue date', 10);
    if (issueDate && !isCalendarDate(issueDate)) throw new WorkspaceError('Enter a valid issue date.', 400);
    if (nextStatus === 'issued' && (!documentId || !issueDate)) {
      throw new WorkspaceError('Attach an uploaded private account document and enter the actual issue date before issuing.', 400);
    }
    if (payload.issue_date !== undefined) {
      updates.issue_date = issueDate ?? null;
      updates.issued_date = issueDate ?? null;
    }
    if (nextStatus === 'in_review' && current.status !== 'in_review') {
      updates.reviewed_at = new Date().toISOString();
      updates.reviewed_by = session.user.id;
    }
    if (nextStatus === 'issued' && current.status !== 'issued') updates.issued_by = session.user.id;
    if (nextStatus === 'delivery_reported' && current.status !== 'delivery_reported') {
      if (!documentId || !issueDate) throw new WorkspaceError('A certificate can only be marked delivery-reported after it has an issued document.', 409);
      const deliveryMethod = requiredText(payload.delivery_method, 'Delivery method', 40);
      if (!['email', 'portal', 'hand_delivery', 'other'].includes(deliveryMethod)) {
        throw new WorkspaceError('Choose a supported delivery method.', 400);
      }
      updates.delivery_method = deliveryMethod;
      updates.delivery_reference = optionalText(payload.delivery_reference, 'Delivery reference', 200) ?? null;
      updates.delivery_reported_at = new Date().toISOString();
      updates.delivery_reported_by = session.user.id;
    }

    const { data, error } = await supabase.from('certificates').update(updates)
      .eq('id', current.id).eq('version', current.version).select(certificateFields).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This certificate changed since it was opened. Refresh and retry.', 409);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'certificates');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as CertificatePayload;
    if (typeof payload.id !== 'string' || !isUuid(payload.id)) throw new WorkspaceError('Select a valid certificate.', 400);
    const { data: current, error } = await supabase.from('certificates')
      .select('id,status,version').eq('id', payload.id).maybeSingle();
    if (error) throw databaseError(error);
    if (!current) throw new WorkspaceError('Certificate not found.', 404);
    if (!isCertificateStatus(current.status) || !canTransitionCertificateStatus(current.status, 'cancelled')) {
      throw new WorkspaceError('An issued or delivery-reported certificate cannot be removed. Keep it in the account history.', 409);
    }
    const { data, error: updateError } = await supabase.from('certificates').update({
      status: 'cancelled',
      updated_by: session.user.id,
    }).eq('id', current.id).eq('version', current.version).select(certificateFields).maybeSingle();
    if (updateError) throw databaseError(updateError);
    if (!data) throw new WorkspaceError('This certificate changed since it was opened. Refresh and retry.', 409);
    return NextResponse.json({ ok: true, certificate: data }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'certificates');
  }
}
