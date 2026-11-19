import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession, requireApiSession } from '../../../lib/api-auth';
import { operationErrorStatus, policyIdentity, policyFields, type PolicyPayload } from '../../../lib/policy-identity';
import { runRenewalRadar } from '../../../lib/renewal-automation';
import { writeCommunicationLog, writeNotification } from '../../../lib/automation';
import { sendOutboundEmail } from '../../../lib/email-adapter';
import { isUuid } from '../../../lib/workspace-validation';
import { policyConfirmation, type PolicyConfirmation } from '../../../lib/policy-confirmation';

import { friendlyErrorMessage } from '../../../lib/workspace-api';
import type { RequestAccess } from '../../../lib/team-request-access';

async function mayWritePolicy(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string, access?: RequestAccess): Promise<boolean> {
  if (access?.mode !== 'legacy') return false;
  if (access.policyAdmin !== undefined) return access.policyAdmin;
  if (access.verifiedOwnerFallback) return true;
  const { data } = await db.from('agency_members').select('user_id').eq('user_id', actor).eq('active', true).eq('role', 'owner').maybeSingle();
  return data?.user_id === actor;
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  const within = request.nextUrl.searchParams.get('renewal_within');
  const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
  if (!Number.isSafeInteger(page) || page < 0) return NextResponse.json({ message: 'Invalid policy page.' }, { status: 400 });
  let query = supabase.from('policies').select('*');
  const account = request.nextUrl.searchParams.get('account_id');
  if (account !== null) {
    if (!isUuid(account)) return NextResponse.json({ message: 'Select a valid account.' }, { status: 400 });
    query = query.eq('client_id', account);
  }
  if (within) {
    const days = Number(within);
    if (!Number.isFinite(days) || days < 0) return NextResponse.json({ message: 'Invalid renewal window.' }, { status: 400 });
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + days);
    query = query.in('status', ['active', 'issued']).lte('renewal_date', end.toISOString().slice(0, 10));
    if (request.nextUrl.searchParams.get('include_overdue') !== 'true') query = query.gte('renewal_date', new Date().toISOString().slice(0, 10));
  }
  const size = within ? 200 : 100;
  const { data, error } = await query.order(within ? 'renewal_date' : 'created_at', { ascending: Boolean(within) })
    .order('id').range(page * size, page * size + size - 1);
  return error ? NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 }) : NextResponse.json(data ?? []);
}

async function savePolicy(request: NextRequest, creating: boolean): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  if (!(await mayWritePolicy(supabase, session.user.id, session.teamAccess))) {
    return NextResponse.json({ message: 'Only administrators can change policy records.' }, { status: 403 });
  }
  let payload: PolicyPayload;
  let fields: PolicyPayload;
  let accountId: string | null = null;
  let leadId: string | null = null;
  let insuredAssetIds: string[] = [];
  let confirmation: PolicyConfirmation | undefined;
  try {
    payload = await request.json() as PolicyPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('A policy object is required.');
    fields = policyFields(payload);
    if (creating) {
      if (payload.request_id !== undefined && !isUuid(payload.request_id)) throw new Error('Use a valid issuance request ID.');
      const selectedAssets = payload.insured_asset_ids ?? [];
      if (!Array.isArray(selectedAssets) || selectedAssets.length > 100
        || !selectedAssets.every((id): id is string => isUuid(id)) || new Set(selectedAssets).size !== selectedAssets.length) {
        throw new Error('Choose up to 100 distinct valid insured assets.');
      }
      insuredAssetIds = selectedAssets;
    }
    if (creating || 'account_id' in payload || 'client_id' in payload) {
      ({ accountId, leadId } = policyIdentity(payload));
      fields.account_id = accountId;
      fields.client_id = accountId;
      if (creating && typeof fields.prior_policy_id === 'string') {
        if (typeof payload.quote_id === 'string') throw new Error('Choose a quote placement or a renewal from a prior policy, not both.');
        if (!isUuid(fields.prior_policy_id)) throw new Error('Select a valid previous policy term.');
        const prior = await supabase.from('policies').select('id')
          .eq('id', fields.prior_policy_id).eq('client_id', accountId).maybeSingle();
        if (prior.error) return NextResponse.json({ message: friendlyErrorMessage(prior.error) }, { status: 500 });
        if (!prior.data) return NextResponse.json({ message: 'Previous policy term was not found on this account.' }, { status: 409 });
      }
      if (creating && (fields.source === 'Renewal' || fields.source === 'Rewrite') && (!fields.prior_policy_id || leadId)) {
        throw new Error('Renewals and rewrites require a previous account policy, not lead completion.');
      }
    }
    if (!creating && 'lead_id' in payload) throw new Error('Lead completion is only supported during issuance.');
    if (!creating && ('quote_id' in payload || 'quote_version' in payload)) throw new Error('Quote linkage is only supported during issuance.');
    if (creating) {
      if (payload.carrier_confirmed !== true) throw new Error('Confirm that the carrier has bound or issued this coverage before recording a policy.');
      confirmation = policyConfirmation(payload.confirmation);
      if ('quote_id' in payload && payload.quote_id !== null
        && (!isUuid(payload.quote_id) || typeof payload.quote_version !== 'string' || !Number.isFinite(Date.parse(payload.quote_version)))) {
        throw new Error('Select a valid quote and its last-loaded version.');
      }
      for (const key of ['insured_name', 'carrier', 'line_of_business', 'policy_number', 'effective_date', 'expiration_date']) {
        if (!fields[key]) throw new Error(`${key} is required.`);
      }
    } else if (!payload.id || !Object.keys(fields).length) throw new Error('Policy ID and update fields are required.');
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Invalid policy.' }, { status: 400 });
  }
  const fromQuote = creating && typeof payload.quote_id === 'string';
  const { data, error } = await supabase.rpc(creating ? 'record_policy_placement_atomic' : 'update_policy_record_atomic', creating ? {
    p_request_id: payload.request_id ?? crypto.randomUUID(), p_account_id: accountId, p_lead_id: leadId, p_policy: fields,
    p_asset_ids: insuredAssetIds,
    p_confirmation: confirmation, p_actor: apiActorName(session.user),
    ...(fromQuote ? { p_quote_id: payload.quote_id, p_quote_version: payload.quote_version } : {}),
  } : { p_id: payload.id, p_updates: fields, p_actor: apiActorName(session.user) });
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: operationErrorStatus(error.code) });
  const saved = data as { policy: Record<string, unknown>; created?: boolean } ;
  const policy = saved.policy;
  const warnings: string[] = [];
  try {
    await runRenewalRadar(supabase, new Date(), String(policy.id));
  } catch (failure) {
    warnings.push(`Policy saved; renewal radar failed and must be retried: ${failure instanceof Error ? failure.message : 'Unknown persistence error'}`);
  }
  if (creating && saved.created && payload.email_consent === true && typeof policy.email === 'string' && policy.email) {
    try {
      await sendOutboundEmail({ to: policy.email, subject: `Policy Issued: ${policy.policy_number}`,
        body: `Hi ${policy.insured_name}, your ${policy.line_of_business} policy with ${policy.carrier} has been issued. Policy number: ${policy.policy_number}. Effective ${policy.effective_date}, expiration ${policy.expiration_date}.`,
        requestId: `policy-issued:${String(policy.id)}`, clientId: String(policy.client_id) });
      await writeCommunicationLog({ client_id: String(policy.client_id), channel: 'email', subject: `Policy Issued: ${policy.policy_number}`,
        body: `Policy issuance confirmation sent for ${policy.insured_name}.`, automation_type: 'renewal' });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unknown email delivery error';
      warnings.push(`Policy saved; issuance email failed: ${message}`);
      await writeNotification({ client_id: String(policy.client_id), type: 'renewal', message: `Policy email failed: ${message}` });
    }
  }
  return NextResponse.json({ ...policy, warnings }, { status: creating ? 201 : 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> { return savePolicy(request, true); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return savePolicy(request, false); }

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  if (!(await mayWritePolicy(supabase, session.user.id, session.teamAccess))) {
    return NextResponse.json({ message: 'Only administrators can change policy records.' }, { status: 403 });
  }
  const payload = await request.json().catch(() => ({})) as { id?: string };
  if (!payload.id) return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  const evidence = await supabase.from('policy_confirmation_evidence').select('policy_id').eq('policy_id', payload.id).maybeSingle();
  if (evidence.error) return NextResponse.json({ message: friendlyErrorMessage(evidence.error) }, { status: 500 });
  if (evidence.data) return NextResponse.json({ message: 'A policy with recorded carrier evidence must be retained. Update its CRM status instead of deleting its history.' }, { status: 409 });
  const { error } = await supabase.from('policies').delete().eq('id', payload.id);
  return error ? NextResponse.json({ message: friendlyErrorMessage(error) }, { status: operationErrorStatus(error.code) }) : NextResponse.json({ ok: true });
}
