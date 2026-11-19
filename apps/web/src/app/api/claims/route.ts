import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { processClaimCreated } from '../../../lib/automation';
import { canTransitionClaimStatus, claimAmount } from '../../../lib/claim-lifecycle';
import { WorkspaceError } from '../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';

interface ClaimPayload {
  id?: unknown;
  version?: unknown;
  policy_id?: unknown;
  client_id?: unknown;
  account_id?: unknown;
  claim_number?: unknown;
  type?: unknown;
  status?: unknown;
  description?: unknown;
  date_of_loss?: unknown;
  adjuster_name?: unknown;
  adjuster_contact?: unknown;
  reserve_amount?: unknown;
  payout_amount?: unknown;
}

interface ClaimRow {
  id: string;
  policy_id: string;
  client_id: string;
  account_id: string | null;
  claim_number: string | null;
  type: string;
  status: string;
  description: string | null;
  date_of_loss: string;
  adjuster_name: string | null;
  adjuster_contact: string | null;
  reserve_amount: number | null;
  payout_amount: number | null;
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

function amountOrThrow(value: unknown, label: string): number | null {
  try {
    return claimAmount(value, label);
  } catch (error) {
    throw new WorkspaceError(error instanceof Error ? error.message : `${label} is invalid.`, 400);
  }
}

const claimFields = 'id,policy_id,client_id,account_id,claim_number,type,status,description,date_of_loss,adjuster_name,adjuster_contact,reserve_amount,payout_amount,version,created_at';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const status = request.nextUrl.searchParams.get('status') ?? 'open';
    const accountId = request.nextUrl.searchParams.get('account_id');
    const policyId = request.nextUrl.searchParams.get('policy_id');
    if (accountId && !isUuid(accountId)) throw new WorkspaceError('Select a valid account.', 400);
    if (policyId && !isUuid(policyId)) throw new WorkspaceError('Select a valid policy.', 400);

    let query = supabase.from('claims')
      .select(`${claimFields},policies(insured_name,carrier)`)
      .order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') query = query.eq('status', status);
    if (accountId) query = query.eq('account_id', accountId);
    if (policyId) query = query.eq('policy_id', policyId);

    const { data, error } = await query;
    if (error) throw databaseError(error);
    const claims = (data ?? []) as Array<ClaimRow & { policies: unknown }>;
    if (claims.length === 0) return NextResponse.json([], { status: 200 });

    const { data: events, error: eventsError } = await supabase.from('claim_record_events')
      .select('id,claim_id,actor_id,event_type,from_status,to_status,snapshot,created_at')
      .in('claim_id', claims.map((claim) => claim.id))
      .order('created_at', { ascending: false });
    if (eventsError) throw databaseError(eventsError);
    const eventsByClaim = new Map<string, NonNullable<typeof events>>();
    for (const event of events ?? []) {
      const current = eventsByClaim.get(event.claim_id) ?? [];
      current.push(event);
      eventsByClaim.set(event.claim_id, current);
    }

    return NextResponse.json(claims.map((claim) => ({ ...claim, events: eventsByClaim.get(claim.id) ?? [] })), { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'claims');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as ClaimPayload;
    if (typeof payload.policy_id !== 'string' || !isUuid(payload.policy_id)) throw new WorkspaceError('Select a valid policy.', 400);
    const type = requiredText(payload.type, 'Claim type', 80);
    const dateOfLoss = requiredText(payload.date_of_loss, 'Date of loss', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfLoss) || Number.isNaN(Date.parse(`${dateOfLoss}T00:00:00Z`))) {
      throw new WorkspaceError('Enter a valid date of loss.', 400);
    }
    const { data: policy, error: policyError } = await supabase.from('policies')
      .select('id,client_id,account_id').eq('id', payload.policy_id).maybeSingle();
    if (policyError) throw databaseError(policyError);
    if (!policy) throw new WorkspaceError('The selected policy could not be found.', 404);
    const clientId = policy.account_id ?? policy.client_id;
    if ((payload.account_id && payload.account_id !== clientId) || (payload.client_id && payload.client_id !== clientId)) {
      throw new WorkspaceError('The selected policy does not belong to that account.', 400);
    }

    const insert = {
      policy_id: policy.id,
      client_id: clientId,
      account_id: clientId,
      claim_number: optionalText(payload.claim_number, 'Claim number', 100) ?? null,
      type,
      status: 'open',
      description: optionalText(payload.description, 'Description', 4000) ?? null,
      date_of_loss: dateOfLoss,
      adjuster_name: optionalText(payload.adjuster_name, 'Adjuster name', 200) ?? null,
      adjuster_contact: optionalText(payload.adjuster_contact, 'Adjuster contact', 300) ?? null,
      reserve_amount: amountOrThrow(payload.reserve_amount, 'Reserve amount'),
      payout_amount: amountOrThrow(payload.payout_amount, 'Payout amount'),
      updated_by: session.user.id,
    };
    const { data, error } = await supabase.from('claims').insert(insert).select(claimFields).single();
    if (error) throw databaseError(error);

    const { data: policyDetails } = await supabase.from('policies').select('insured_name').eq('id', policy.id).maybeSingle();
    await processClaimCreated({
      claimId: data.id,
      clientId: data.client_id,
      insuredName: policyDetails?.insured_name ?? `Policy ${data.policy_id}`,
      claimType: data.type,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'claims');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as ClaimPayload;
    if (typeof payload.id !== 'string' || !isUuid(payload.id)) throw new WorkspaceError('Select a valid claim.', 400);
    if (!Number.isInteger(payload.version) || Number(payload.version) < 1) throw new WorkspaceError('Refresh the claim before saving your changes.', 400);
    const { data: current, error: currentError } = await supabase.from('claims')
      .select('id,policy_id,client_id,status,version').eq('id', payload.id).maybeSingle();
    if (currentError) throw databaseError(currentError);
    if (!current) throw new WorkspaceError('Claim not found.', 404);
    if (current.version !== payload.version) throw new WorkspaceError('This claim changed since it was opened. Refresh and retry.', 409);

    const updates: Record<string, string | number | null> = { updated_by: session.user.id };
    const policyId = typeof payload.policy_id === 'string' ? payload.policy_id : current.policy_id;
    if (!isUuid(policyId)) throw new WorkspaceError('Select a valid policy.', 400);
    if (policyId !== current.policy_id) {
      const { data: policy, error: policyError } = await supabase.from('policies').select('id,client_id,account_id').eq('id', policyId).maybeSingle();
      if (policyError) throw databaseError(policyError);
      if (!policy || (policy.account_id ?? policy.client_id) !== current.client_id) {
        throw new WorkspaceError('A claim can only be moved to another policy on the same account.', 400);
      }
      updates.policy_id = policyId;
    }
    if (typeof payload.type === 'string') updates.type = requiredText(payload.type, 'Claim type', 80);
    if (typeof payload.status === 'string') {
      const nextStatus = requiredText(payload.status, 'Claim status', 40);
      if (!canTransitionClaimStatus(current.status, nextStatus)) {
        throw new WorkspaceError(`A ${current.status} claim cannot move directly to ${nextStatus}.`, 409);
      }
      updates.status = nextStatus;
    }
    const description = optionalText(payload.description, 'Description', 4000);
    const claimNumber = optionalText(payload.claim_number, 'Claim number', 100);
    const dateOfLoss = optionalText(payload.date_of_loss, 'Date of loss', 10);
    const adjusterName = optionalText(payload.adjuster_name, 'Adjuster name', 200);
    const adjusterContact = optionalText(payload.adjuster_contact, 'Adjuster contact', 300);
    if (description !== undefined) updates.description = description;
    if (claimNumber !== undefined) updates.claim_number = claimNumber;
    if (dateOfLoss !== undefined) updates.date_of_loss = dateOfLoss;
    if (adjusterName !== undefined) updates.adjuster_name = adjusterName;
    if (adjusterContact !== undefined) updates.adjuster_contact = adjusterContact;
    if (Object.prototype.hasOwnProperty.call(payload, 'reserve_amount')) updates.reserve_amount = amountOrThrow(payload.reserve_amount, 'Reserve amount');
    if (Object.prototype.hasOwnProperty.call(payload, 'payout_amount')) updates.payout_amount = amountOrThrow(payload.payout_amount, 'Payout amount');

    const { data, error } = await supabase.from('claims').update(updates)
      .eq('id', current.id).eq('version', current.version).select(claimFields).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This claim changed since it was opened. Refresh and retry.', 409);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'claims');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const payload = await workspaceBody(request) as ClaimPayload;
    if (typeof payload.id !== 'string' || !isUuid(payload.id)) throw new WorkspaceError('Select a valid claim.', 400);
    const { data: current, error } = await supabase.from('claims').select('id,status,version').eq('id', payload.id).maybeSingle();
    if (error) throw databaseError(error);
    if (!current) throw new WorkspaceError('Claim not found.', 404);
    const { data, error: updateError } = await supabase.from('claims').update({
      status: current.status === 'closed' ? current.status : 'closed',
      updated_by: session.user.id,
    }).eq('id', current.id).eq('version', current.version).select(claimFields).maybeSingle();
    if (updateError) throw databaseError(updateError);
    if (!data) throw new WorkspaceError('This claim changed since it was opened. Refresh and retry.', 409);
    return NextResponse.json({ ok: true, claim: data }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'claims');
  }
}
