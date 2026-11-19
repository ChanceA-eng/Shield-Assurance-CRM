import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { canTransitionRenewalReview, isRenewalCalendarDate, isRenewalReviewStatus } from '../../../../lib/renewal-review';
import { WorkspaceError } from '../../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';

interface RenewalReviewPayload {
  id?: unknown;
  version?: unknown;
  policy_id?: unknown;
  renewal_term?: unknown;
  status?: unknown;
  assigned_to?: unknown;
  notes?: unknown;
  follow_up_date?: unknown;
  next_policy_id?: unknown;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw new WorkspaceError(`${label} must be ${maxLength} characters or fewer.`, 400);
  return value.trim() || null;
}

function optionalUuid(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!isUuid(value)) throw new WorkspaceError(`Choose a valid ${label}.`, 400);
  return value;
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
  if (!data?.active) throw new WorkspaceError('Assign the renewal to an active agency member.', 403);
}

async function validateRenewalTerm(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  policyId: string,
  renewalTerm: string,
): Promise<{ accountId: string }> {
  const { data, error } = await supabase.from('policies')
    .select('id,client_id,account_id,renewal_date,expiration_date,status').eq('id', policyId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new WorkspaceError('Renewing policy not found.', 404);
  const currentTerm = data.renewal_date ?? data.expiration_date;
  if (currentTerm !== renewalTerm || !['active', 'issued', 'bound', 'in_force', 'inforce'].includes(String(data.status).toLowerCase())) {
    throw new WorkspaceError('This policy term changed. Refresh the renewal before saving.', 409);
  }
  const accountId = data.account_id ?? data.client_id;
  if (!accountId) throw new WorkspaceError('The renewing policy is not linked to an account.', 409);
  return { accountId };
}

async function validateNextPolicy(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  policyId: string,
  accountId: string,
  nextPolicyId: string | null,
): Promise<void> {
  if (!nextPolicyId) throw new WorkspaceError('Link the issued next term before recording a renewed outcome.', 400);
  const { data, error } = await supabase.from('policies')
    .select('id,client_id,account_id,prior_policy_id').eq('id', nextPolicyId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data || (data.account_id ?? data.client_id) !== accountId || data.prior_policy_id !== policyId) {
    throw new WorkspaceError('Choose a policy on the same account that was issued from this renewal term.', 400);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as RenewalReviewPayload;
    if (typeof payload.policy_id !== 'string' || !isUuid(payload.policy_id)) throw new WorkspaceError('Select a valid policy.', 400);
    if (!isRenewalCalendarDate(payload.renewal_term)) throw new WorkspaceError('Choose a valid renewal term.', 400);
    const { accountId } = await validateRenewalTerm(supabase, payload.policy_id, payload.renewal_term);
    const assignedTo = optionalUuid(payload.assigned_to, 'renewal owner') ?? session.user.id;
    await validateAssignee(supabase, session.user.id, assignedTo);
    const notes = optionalText(payload.notes, 'Review notes', 4000) ?? null;
    const followUpDate = optionalText(payload.follow_up_date, 'Follow-up date', 10) ?? null;
    if (followUpDate && !isRenewalCalendarDate(followUpDate)) throw new WorkspaceError('Enter a valid follow-up date.', 400);

    const { data, error } = await supabase.from('renewal_reviews').insert({
      policy_id: payload.policy_id,
      account_id: accountId,
      renewal_term: payload.renewal_term,
      status: 'in_review',
      assigned_to: assignedTo,
      notes,
      follow_up_date: followUpDate,
      updated_by: session.user.id,
    }).select('id,policy_id,account_id,renewal_term,status,assigned_to,notes,follow_up_date,next_policy_id,version,updated_at,created_at').single();
    if (error) throw databaseError(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'renewal-review');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as RenewalReviewPayload;
    if (typeof payload.id !== 'string' || !isUuid(payload.id)) throw new WorkspaceError('Select a valid renewal review.', 400);
    if (!Number.isInteger(payload.version) || Number(payload.version) < 1) throw new WorkspaceError('Refresh the renewal review before saving.', 400);
    const { data: current, error: currentError } = await supabase.from('renewal_reviews')
      .select('id,policy_id,account_id,renewal_term,status,assigned_to,next_policy_id,version')
      .eq('id', payload.id).maybeSingle();
    if (currentError) throw databaseError(currentError);
    if (!current) throw new WorkspaceError('Renewal review not found.', 404);
    if (current.version !== payload.version) throw new WorkspaceError('This renewal changed since it was opened. Refresh and retry.', 409);
    await validateRenewalTerm(supabase, current.policy_id, current.renewal_term);

    const status = payload.status === undefined ? current.status : payload.status;
    if (typeof status !== 'string' || !isRenewalReviewStatus(status) || !canTransitionRenewalReview(current.status, status)) {
      throw new WorkspaceError('Choose a valid next renewal outcome.', 409);
    }
    const assignedTo = optionalUuid(payload.assigned_to, 'renewal owner');
    if (assignedTo !== undefined) await validateAssignee(supabase, session.user.id, assignedTo);
    const notes = optionalText(payload.notes, 'Review notes', 4000);
    const followUpDate = optionalText(payload.follow_up_date, 'Follow-up date', 10);
    if (followUpDate && !isRenewalCalendarDate(followUpDate)) throw new WorkspaceError('Enter a valid follow-up date.', 400);
    const nextPolicyId = status === 'renewed'
      ? optionalUuid(payload.next_policy_id, 'next policy') ?? current.next_policy_id
      : null;
    if (status === 'renewed') await validateNextPolicy(supabase, current.policy_id, current.account_id, nextPolicyId);

    const updates: Record<string, string | null> = { status, updated_by: session.user.id, next_policy_id: nextPolicyId };
    if (assignedTo !== undefined) updates.assigned_to = assignedTo;
    if (notes !== undefined) updates.notes = notes;
    if (followUpDate !== undefined) updates.follow_up_date = followUpDate;
    const { data, error } = await supabase.from('renewal_reviews').update(updates)
      .eq('id', current.id).eq('version', current.version)
      .select('id,policy_id,account_id,renewal_term,status,assigned_to,notes,follow_up_date,next_policy_id,version,updated_at,created_at')
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This renewal changed since it was opened. Refresh and retry.', 409);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'renewal-review');
  }
}
