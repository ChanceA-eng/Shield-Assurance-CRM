import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

interface PolicyChangeRequestPayload {
  id?: string;
  policy_id?: string;
  description?: string;
  status?: 'draft' | 'submitted' | 'processed';
  requested_by?: string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const policyId = normalizeText(request.nextUrl.searchParams.get('policy_id'));
  const status = normalizeText(request.nextUrl.searchParams.get('status'));

  let query = supabase
    .from('policy_change_requests')
    .select('id,policy_id,requested_at,description,status,requested_by,created_at,updated_at,policies(account_id,client_id,insured_name,carrier,policy_number,line_of_business,sub_type)')
    .order('requested_at', { ascending: false })
    .limit(200);

  if (policyId) query = query.eq('policy_id', policyId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as PolicyChangeRequestPayload;
  const policyId = normalizeText(payload.policy_id);
  const description = normalizeText(payload.description);

  if (!policyId || !description) {
    return NextResponse.json({ message: 'policy_id and description are required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('policy_change_requests')
    .insert([
      {
        policy_id: policyId,
        description,
        status: payload.status ?? 'draft',
        requested_by: normalizeText(payload.requested_by ?? null),
      },
    ])
    .select('id,policy_id,requested_at,description,status,requested_by,created_at,updated_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as PolicyChangeRequestPayload;
  const id = normalizeText(payload.id);
  if (!id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (typeof payload.description === 'string') updates.description = normalizeText(payload.description);
  if (payload.status) updates.status = payload.status;
  if (Object.prototype.hasOwnProperty.call(payload, 'requested_by')) updates.requested_by = normalizeText(payload.requested_by ?? null);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('policy_change_requests')
    .update(updates)
    .eq('id', id)
    .select('id,policy_id,requested_at,description,status,requested_by,created_at,updated_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as { id?: string };
  const id = normalizeText(payload.id);
  if (!id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('policy_change_requests').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
