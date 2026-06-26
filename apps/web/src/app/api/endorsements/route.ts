import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { processEndorsementCreated } from '../../../lib/automation';

interface NewEndorsementPayload {
  id?: string;
  policy_id?: string;
  client_id?: string;
  type?: string;
  description?: string;
  effective_date?: string;
  status?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'open';

  let query = supabase
    .from('endorsements')
    .select('id,policy_id,client_id,type,description,effective_date,status,created_at,policies(insured_name,carrier),clients(full_name)')
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

  const payload = (await request.json()) as NewEndorsementPayload;
  if (!payload.policy_id || !payload.type || !payload.effective_date) {
    return NextResponse.json({ message: 'policy_id, type and effective_date are required.' }, { status: 400 });
  }

  let clientId = payload.client_id?.trim() ?? '';
  if (!clientId) {
    const policyResult = await supabase.from('policies').select('client_id').eq('id', payload.policy_id).maybeSingle();
    if (policyResult.error) {
      return NextResponse.json({ message: policyResult.error.message }, { status: 500 });
    }

    clientId = policyResult.data?.client_id ?? '';
  }

  if (!clientId) {
    return NextResponse.json({ message: 'Unable to resolve client for selected policy.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('endorsements')
    .insert([
      {
        policy_id: payload.policy_id,
        client_id: clientId,
        type: payload.type,
        description: payload.description?.trim() || null,
        effective_date: payload.effective_date,
        status: payload.status?.trim() || 'open',
      },
    ])
    .select('id,policy_id,client_id,type,description,effective_date,status,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await processEndorsementCreated({
    endorsementId: data.id,
    clientId: data.client_id,
    insuredName: `Policy ${data.policy_id}`,
    type: data.type,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewEndorsementPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (typeof payload.policy_id === 'string') updates.policy_id = payload.policy_id;
  if (typeof payload.client_id === 'string') updates.client_id = payload.client_id;
  if (typeof payload.type === 'string') updates.type = payload.type;
  if (typeof payload.description === 'string') updates.description = payload.description.trim() || null;
  if (typeof payload.effective_date === 'string') updates.effective_date = payload.effective_date;
  if (typeof payload.status === 'string') updates.status = payload.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase.from('endorsements').update(updates).eq('id', payload.id).select('*').single();
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

  const { error } = await supabase.from('endorsements').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
