import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { policyIdentity } from '../../../../lib/policy-identity';
import { ACTIVE_LEAD_STATUSES } from '../../../../lib/lead-pipeline';
import { isUuid } from '../../../../lib/workspace-validation';
import type { QuoteOption } from '../../../../lib/quote-options';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  let identity: ReturnType<typeof policyIdentity>;
  try {
    identity = policyIdentity({
      account_id: request.nextUrl.searchParams.get('account_id'),
      lead_id: request.nextUrl.searchParams.get('lead_id'),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Invalid placement identity.' }, { status: 400 });
  }
  const quoteId = request.nextUrl.searchParams.get('quote_id');
  const renewalId = request.nextUrl.searchParams.get('renew_from_id');
  if (quoteId !== null && renewalId !== null) return NextResponse.json({ message: 'Choose quote placement or policy renewal, not both.' }, { status: 400 });
  if (renewalId !== null && identity.leadId) return NextResponse.json({ message: 'Start a renewal from its account policy term, not a new lead.' }, { status: 400 });
  const { data: account, error: accountError } = await supabase.from('clients')
    .select('id,full_name,phone,email,address').eq('id', identity.accountId).maybeSingle();
  if (accountError) return NextResponse.json({ message: accountError.message }, { status: 500 });
  if (!account) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
  let contact = account;
  let lineOfBusiness = '';
  if (identity.leadId) {
    const { data: lead, error } = await supabase.from('leads')
      .select('id,full_name,phone,email,address,line_of_business,account_id,status').eq('id', identity.leadId).maybeSingle();
    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    if (!lead) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
    if (lead.account_id !== account.id) return NextResponse.json({ message: 'Link this lead to the selected account before recording a policy.' }, { status: 409 });
    if (!ACTIVE_LEAD_STATUSES.some((status) => status === lead.status)) return NextResponse.json({ message: 'This lead is no longer active. Record another policy from its account instead.' }, { status: 409 });
    contact = lead;
    lineOfBusiness = lead.line_of_business ?? '';
  }
  let renewal: Record<string, unknown> | null = null;
  if (renewalId !== null) {
    if (!isUuid(renewalId)) return NextResponse.json({ message: 'Select a valid previous policy term.' }, { status: 400 });
    const result = await supabase.from('policies')
      .select('id,client_id,insured_name,phone,email,address,carrier,line_of_business,sub_type,premium,policy_number,effective_date,renewal_date,expiration_date')
      .eq('id', renewalId).eq('client_id', account.id).maybeSingle();
    if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ message: 'Previous policy term was not found on this account.' }, { status: 404 });
    renewal = result.data;
  }
  let quote: QuoteOption | null = null;
  if (quoteId !== null) {
    if (!isUuid(quoteId)) return NextResponse.json({ message: 'Select a valid quote option.' }, { status: 400 });
    const result = await supabase.from('quote_options').select('*').eq('id', quoteId).eq('client_id', account.id).maybeSingle<QuoteOption>();
    if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ message: 'Quote not found in this account.' }, { status: 404 });
    quote = result.data;
    if (quote.status !== 'accepted' || (identity.leadId && quote.lead_id !== identity.leadId)) {
      return NextResponse.json({ message: 'Select an accepted quote belonging to this lead/account.' }, { status: 409 });
    }
    const placed = await supabase.from('policies').select('id').eq('quote_option_id', quote.id).maybeSingle();
    if (placed.error) return NextResponse.json({ message: placed.error.message }, { status: 500 });
    if (placed.data) return NextResponse.json({ message: 'A policy is already recorded from this quote. Open the account Policies section.' }, { status: 409 });
  }
  return NextResponse.json({
    account_id: account.id, account_name: account.full_name, lead_id: identity.leadId,
    insured_name: renewal?.insured_name ?? contact.full_name, phone: renewal?.phone ?? contact.phone ?? '', email: renewal?.email ?? contact.email ?? '',
    address: renewal?.address ?? contact.address ?? '', line_of_business: renewal?.line_of_business ?? lineOfBusiness,
    ...(renewal ? { prior_policy_id: renewal.id, prior_policy_number: renewal.policy_number,
      prior_expiration_date: renewal.expiration_date ?? renewal.renewal_date, carrier: renewal.carrier,
      premium: renewal.premium, sub_type: renewal.sub_type } : {}),
    ...(quote ? { quote_id: quote.id, quote_version: quote.updated_at, carrier: quote.carrier,
      premium: quote.premium, line_of_business: quote.line_of_business, effective_date: quote.effective_date,
      expiration_date: quote.expiration_date, limits: quote.limits, deductibles: quote.deductibles } : {}),
  });
}
