import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { processClaimCreated } from '../../../lib/automation';

interface NewClaimPayload {
  id?: string;
  policy_id?: string;
  client_id?: string;
  account_id?: string;
  claim_number?: string;
  type?: string;
  status?: string;
  description?: string;
  date_of_loss?: string;
  adjuster_name?: string;
  adjuster_contact?: string;
  reserve_amount?: number | string | null;
  payout_amount?: number | string | null;
}

function normalizeAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'open';

  let query = supabase
    .from('claims')
    .select('id,policy_id,client_id,account_id,claim_number,type,status,description,date_of_loss,adjuster_name,adjuster_contact,reserve_amount,payout_amount,created_at,policies(insured_name,carrier)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewClaimPayload;
  if (!payload.policy_id || !payload.type || !payload.date_of_loss) {
    return NextResponse.json({ message: 'policy_id, type and date_of_loss are required.' }, { status: 400 });
  }

  let clientId = payload.account_id?.trim() || payload.client_id?.trim() || '';
  if (!clientId) {
    const policyResult = await supabase.from('policies').select('client_id,account_id').eq('id', payload.policy_id).maybeSingle();
    if (policyResult.error) {
      return NextResponse.json({ message: policyResult.error.message }, { status: 500 });
    }

    clientId = policyResult.data?.account_id ?? policyResult.data?.client_id ?? '';
  }

  if (!clientId) {
    return NextResponse.json({ message: 'Unable to resolve client for selected policy.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claims')
    .insert([
      {
        policy_id: payload.policy_id,
        client_id: clientId,
        account_id: clientId,
        claim_number: payload.claim_number?.trim() || null,
        type: payload.type,
        status: payload.status?.trim() || 'open',
        description: payload.description?.trim() || null,
        date_of_loss: payload.date_of_loss,
        adjuster_name: payload.adjuster_name?.trim() || null,
        adjuster_contact: payload.adjuster_contact?.trim() || null,
        reserve_amount: normalizeAmount(payload.reserve_amount),
        payout_amount: normalizeAmount(payload.payout_amount),
      },
    ])
    .select('id,policy_id,client_id,account_id,claim_number,type,status,description,date_of_loss,adjuster_name,adjuster_contact,reserve_amount,payout_amount,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await processClaimCreated({
    claimId: data.id,
    clientId: data.client_id,
    insuredName: `Policy ${data.policy_id}`,
    claimType: data.type,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewClaimPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | number | null> = {};
  if (typeof payload.policy_id === 'string') updates.policy_id = payload.policy_id;
  if (typeof payload.client_id === 'string') updates.client_id = payload.client_id;
  if (typeof payload.account_id === 'string') updates.account_id = payload.account_id;
  if (typeof payload.claim_number === 'string') updates.claim_number = payload.claim_number.trim() || null;
  if (typeof payload.type === 'string') updates.type = payload.type;
  if (typeof payload.status === 'string') updates.status = payload.status;
  if (typeof payload.description === 'string') updates.description = payload.description.trim() || null;
  if (typeof payload.date_of_loss === 'string') updates.date_of_loss = payload.date_of_loss;
  if (typeof payload.adjuster_name === 'string') updates.adjuster_name = payload.adjuster_name.trim() || null;
  if (typeof payload.adjuster_contact === 'string') updates.adjuster_contact = payload.adjuster_contact.trim() || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'reserve_amount')) updates.reserve_amount = normalizeAmount(payload.reserve_amount);
  if (Object.prototype.hasOwnProperty.call(payload, 'payout_amount')) updates.payout_amount = normalizeAmount(payload.payout_amount);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase.from('claims').update(updates).eq('id', payload.id).select('*').single();
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('claims').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
