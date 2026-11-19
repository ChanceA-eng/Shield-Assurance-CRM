import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { canTransitionPolicyServiceRequest, isCalendarDate, isPolicyServiceRequestStatus, isPolicyServiceRequestType } from '../../../lib/policy-service-requests';
import { WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';

interface PolicyChangeRequestRow {
  id: string;
  policy_id: string;
  requested_at: string;
  description: string;
  status: string;
  request_type: string;
  requested_effective_date: string | null;
  carrier_submitted_at: string | null;
  carrier_confirmed_on: string | null;
  confirmation_reference: string | null;
  requested_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  policies: {
    client_id: string;
    insured_name: string;
    carrier: string;
    policy_number: string | null;
    line_of_business: string;
  };
}

interface PolicyChangeRequestEvent {
  id: string;
  request_id: string;
  actor_id: string | null;
  event_type: 'created' | 'updated' | 'status_changed';
  from_status: string | null;
  to_status: string;
  snapshot: Record<string, unknown>;
  created_at: string;
}

async function validateAssignee(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  actorId: string,
  assigneeId: string | null,
): Promise<void> {
  if (!assigneeId || assigneeId === actorId) return;
  const { data, error } = await supabase.from('agency_members').select('user_id,active')
    .eq('user_id', assigneeId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data?.active) throw new WorkspaceError('Assign the request to an active agency member.', 403);
}

function optionalText(value: unknown, label: string, limit: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > limit) throw new WorkspaceError(`${label} must be ${limit} characters or fewer.`, 400);
  return value.trim() || null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const accountId = request.nextUrl.searchParams.get('account_id');
    const policyId = request.nextUrl.searchParams.get('policy_id');
    const status = request.nextUrl.searchParams.get('status');
    if (accountId && !isUuid(accountId)) throw new WorkspaceError('Select a valid account.', 400);
    if (policyId && !isUuid(policyId)) throw new WorkspaceError('Select a valid policy.', 400);
    if (status && status !== 'processed' && !isPolicyServiceRequestStatus(status)) throw new WorkspaceError('Choose a valid request status.', 400);

    let query = supabase.from('policy_change_requests')
      .select('id,policy_id,requested_at,description,status,request_type,requested_effective_date,carrier_submitted_at,carrier_confirmed_on,confirmation_reference,requested_by,assigned_to,created_at,updated_at,version,policies!inner(client_id,insured_name,carrier,policy_number,line_of_business)')
      .order('created_at', { ascending: false }).limit(200);
    if (accountId) query = query.eq('policies.client_id', accountId);
    if (policyId) query = query.eq('policy_id', policyId);
    if (status) query = query.eq('status', status);
    const result = await query.returns<PolicyChangeRequestRow[]>();
    if (result.error) throw databaseError(result.error);
    const rows = result.data ?? [];
    if (!rows.length) return NextResponse.json([]);

    const ids = rows.map((row) => row.id);
    const assignedIds = [...new Set(rows.flatMap((row) => row.assigned_to ? [row.assigned_to] : []))];
    const [eventsResult, tasksResult, membersResult] = await Promise.all([
      supabase.from('policy_change_request_events')
        .select('id,request_id,actor_id,event_type,from_status,to_status,snapshot,created_at')
        .in('request_id', ids).order('created_at').order('id')
        .returns<PolicyChangeRequestEvent[]>(),
      supabase.from('tasks').select('id,automation_key,status')
        .in('automation_key', ids.map((id) => `service:policy_change_request:${id}`))
        .returns<Array<{ id: string; automation_key: string; status: string }>>(),
      assignedIds.length
        ? supabase.from('agency_members').select('user_id,email').in('user_id', assignedIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsResult.error) throw databaseError(eventsResult.error);
    if (tasksResult.error) throw databaseError(tasksResult.error);
    if (membersResult.error) throw databaseError(membersResult.error);

    const memberEmails = new Map((membersResult.data ?? []).map((member) => [member.user_id, member.email]));
    const eventsByRequest = new Map<string, PolicyChangeRequestEvent[]>();
    for (const event of eventsResult.data ?? []) {
      const events = eventsByRequest.get(event.request_id) ?? [];
      events.push(event);
      eventsByRequest.set(event.request_id, events);
    }
    const taskByRequest = new Map((tasksResult.data ?? []).map((task) => [
      task.automation_key.replace('service:policy_change_request:', ''),
      { id: task.id, status: task.status },
    ]));
    return NextResponse.json(rows.map((row) => ({
      ...row,
      assigned_email: row.assigned_to ? memberEmails.get(row.assigned_to) ?? null : null,
      events: eventsByRequest.get(row.id) ?? [],
      task: taskByRequest.get(row.id) ?? null,
    })));
  } catch (error) {
    return workspaceApiError(error, 'policy-change-requests/get');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const body = await workspaceBody(request);
    if (!isUuid(body.policy_id)) throw new WorkspaceError('Select a valid policy.', 400);
    if (!isPolicyServiceRequestType(body.request_type)) throw new WorkspaceError('Choose a supported service request type.', 400);
    if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 4000) {
      throw new WorkspaceError('Describe the requested service change in 1-4,000 characters.', 400);
    }
    if (body.requested_effective_date !== undefined && body.requested_effective_date !== null
      && !isCalendarDate(body.requested_effective_date)) {
      throw new WorkspaceError('Enter a valid requested effective date.', 400);
    }
    const assignedTo = body.assigned_to === undefined || body.assigned_to === null || body.assigned_to === ''
      ? session.user.id
      : body.assigned_to;
    if (!isUuid(assignedTo)) throw new WorkspaceError('Choose a valid request owner.', 400);
    await validateAssignee(supabase, session.user.id, assignedTo);
    const accountId = body.account_id;
    if (!isUuid(accountId)) throw new WorkspaceError('Select the account for this request.', 400);
    const policyResult = await supabase.from('policies').select('id')
      .eq('id', body.policy_id).eq('client_id', accountId).maybeSingle();
    if (policyResult.error) throw databaseError(policyResult.error);
    if (!policyResult.data) throw new WorkspaceError('The selected policy does not belong to this account.', 404);

    const result = await supabase.from('policy_change_requests').insert({
      policy_id: body.policy_id,
      request_type: body.request_type,
      requested_effective_date: body.requested_effective_date ?? null,
      description: body.description.trim(),
      status: 'draft',
      requested_by: session.user.id,
      assigned_to: assignedTo,
      updated_by: session.user.id,
    }).select('id,policy_id,requested_at,description,status,request_type,requested_effective_date,carrier_submitted_at,carrier_confirmed_on,confirmation_reference,requested_by,assigned_to,created_at,updated_at,version')
      .single();
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'policy-change-requests/post');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('Choose a current service request.', 400);
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new WorkspaceError('Refresh this request before saving.', 400);
    const currentResult = await supabase.from('policy_change_requests')
      .select('id,status,version,carrier_confirmed_on,confirmation_reference')
      .eq('id', body.id).maybeSingle();
    if (currentResult.error) throw databaseError(currentResult.error);
    if (!currentResult.data) throw new WorkspaceError('This service request no longer exists.', 404);
    const current = currentResult.data as {
      id: string; status: string; version: number; carrier_confirmed_on: string | null; confirmation_reference: string | null;
    };
    if (current.version !== body.version) throw new WorkspaceError('Someone else updated this request. Refresh before saving.', 409);

    const updates: Record<string, string | null> = {};
    const description = optionalText(body.description, 'Description', 4000);
    if (description !== undefined) {
      if (!description) throw new WorkspaceError('A service request needs a description.', 400);
      updates.description = description;
    }
    if (body.request_type !== undefined) {
      if (!isPolicyServiceRequestType(body.request_type)) throw new WorkspaceError('Choose a supported service request type.', 400);
      updates.request_type = body.request_type;
    }
    if (body.requested_effective_date !== undefined) {
      if (body.requested_effective_date !== null && !isCalendarDate(body.requested_effective_date)) {
        throw new WorkspaceError('Enter a valid requested effective date.', 400);
      }
      updates.requested_effective_date = body.requested_effective_date;
    }
    const confirmationReference = optionalText(body.confirmation_reference, 'Carrier reference', 500);
    if (confirmationReference !== undefined) updates.confirmation_reference = confirmationReference;
    if (body.carrier_confirmed_on !== undefined) {
      if (body.carrier_confirmed_on !== null && !isCalendarDate(body.carrier_confirmed_on)) {
        throw new WorkspaceError('Enter a valid carrier confirmation date.', 400);
      }
      updates.carrier_confirmed_on = body.carrier_confirmed_on;
    }
    const resultingConfirmedOn = Object.prototype.hasOwnProperty.call(body, 'carrier_confirmed_on')
      ? body.carrier_confirmed_on : current.carrier_confirmed_on;
    const resultingReference = Object.prototype.hasOwnProperty.call(body, 'confirmation_reference')
      ? confirmationReference : current.confirmation_reference;
    if (Boolean(resultingConfirmedOn) !== Boolean(resultingReference)) {
      throw new WorkspaceError('Carrier confirmation date and reference must be saved together.', 400);
    }
    if (body.status !== undefined) {
      if (!isPolicyServiceRequestStatus(body.status) || !canTransitionPolicyServiceRequest(current.status, body.status)) {
        throw new WorkspaceError('That request status change is not allowed. Refresh and review the current status.', 409);
      }
      if (body.status === 'confirmed' && (!resultingConfirmedOn || !resultingReference)) {
        throw new WorkspaceError('Record the carrier confirmation date and reference before marking this request confirmed.', 400);
      }
      if (body.status === 'submitted' || body.status === 'waiting_on_carrier') {
        updates.carrier_submitted_at = new Date().toISOString();
      }
      updates.status = body.status;
    }
    if (body.assigned_to !== undefined) {
      if (body.assigned_to !== null && body.assigned_to !== '' && !isUuid(body.assigned_to)) {
        throw new WorkspaceError('Choose a valid request owner.', 400);
      }
      const assignedTo = body.assigned_to === null || body.assigned_to === '' ? null : body.assigned_to;
      await validateAssignee(supabase, session.user.id, assignedTo);
      updates.assigned_to = assignedTo;
    }
    if (!Object.keys(updates).length) throw new WorkspaceError('No update fields were provided.', 400);
    updates.updated_by = session.user.id;

    const result = await supabase.from('policy_change_requests').update(updates)
      .eq('id', body.id).eq('version', current.version)
      .select('id,policy_id,requested_at,description,status,request_type,requested_effective_date,carrier_submitted_at,carrier_confirmed_on,confirmation_reference,requested_by,assigned_to,created_at,updated_at,version')
      .maybeSingle();
    if (result.error) throw databaseError(result.error);
    if (!result.data) throw new WorkspaceError('Someone else updated this request. Refresh before saving.', 409);
    return NextResponse.json(result.data);
  } catch (error) {
    return workspaceApiError(error, 'policy-change-requests/patch');
  }
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json({ message: 'Service requests are retained for history. Change the status to Cancelled instead.' }, { status: 405 });
}
