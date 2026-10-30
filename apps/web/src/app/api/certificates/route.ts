import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { processCertificateCreated } from '../../../lib/automation';

interface NewCertificatePayload {
  id?: string;
  policy_id?: string;
  client_id?: string;
  account_id?: string;
  certificate_holder?: string;
  holder_name?: string;
  holder_address?: string;
  description?: string;
  issue_date?: string;
  issued_date?: string;
  expiration_date?: string;
  coverage_summary?: string;
  file_path?: string;
  is_master?: boolean;
  master_template_id?: string | null;
  status?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'all';

  let query = supabase
    .from('certificates')
    .select('id,policy_id,client_id,account_id,certificate_holder,holder_name,holder_address,description,issue_date,issued_date,expiration_date,coverage_summary,file_path,is_master,master_template_id,status,created_at,policies(insured_name,carrier)')
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

  const payload = (await request.json()) as NewCertificatePayload;
  const holderName = payload.holder_name?.trim() || payload.certificate_holder?.trim() || '';
  const issuedDate = payload.issued_date || payload.issue_date;
  if (!holderName || !issuedDate) {
    return NextResponse.json({ message: 'holder_name and issued_date are required.' }, { status: 400 });
  }

  let clientId = payload.account_id?.trim() || payload.client_id?.trim() || '';
  if (!clientId && payload.policy_id) {
    const policyResult = await supabase.from('policies').select('client_id,account_id').eq('id', payload.policy_id).maybeSingle();
    if (policyResult.error) {
      return NextResponse.json({ message: policyResult.error.message }, { status: 500 });
    }

    clientId = policyResult.data?.account_id ?? policyResult.data?.client_id ?? '';
  }

  if (!clientId) {
    return NextResponse.json({ message: 'Unable to resolve account for certificate.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('certificates')
    .insert([
      {
        policy_id: payload.policy_id?.trim() || null,
        client_id: clientId,
        account_id: clientId,
        certificate_holder: holderName,
        holder_name: holderName,
        holder_address: payload.holder_address?.trim() || null,
        description: payload.description?.trim() || null,
        issue_date: issuedDate,
        issued_date: issuedDate,
        expiration_date: payload.expiration_date || null,
        coverage_summary: payload.coverage_summary?.trim() || payload.description?.trim() || null,
        file_path: payload.file_path?.trim() || null,
        is_master: payload.is_master ?? false,
        master_template_id: payload.master_template_id?.trim() || null,
        status: payload.status?.trim() || 'issued',
      },
    ])
    .select('id,policy_id,client_id,account_id,certificate_holder,holder_name,holder_address,description,issue_date,issued_date,expiration_date,coverage_summary,file_path,is_master,master_template_id,status,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await processCertificateCreated({
    certificateId: data.id,
    clientId: data.client_id,
    insuredName: data.policy_id ? `Policy ${data.policy_id}` : 'Master certificate',
    certificateHolder: data.certificate_holder,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewCertificatePayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | boolean | null> = {};
  if (typeof payload.policy_id === 'string') updates.policy_id = payload.policy_id.trim() || null;
  if (typeof payload.client_id === 'string') updates.client_id = payload.client_id;
  if (typeof payload.account_id === 'string') updates.account_id = payload.account_id;
  if (typeof payload.certificate_holder === 'string') updates.certificate_holder = payload.certificate_holder.trim();
  if (typeof payload.holder_name === 'string') updates.holder_name = payload.holder_name.trim();
  if (typeof payload.holder_address === 'string') updates.holder_address = payload.holder_address.trim() || null;
  if (typeof payload.description === 'string') updates.description = payload.description.trim() || null;
  if (typeof payload.issue_date === 'string') updates.issue_date = payload.issue_date;
  if (typeof payload.issued_date === 'string') updates.issued_date = payload.issued_date;
  if (typeof payload.expiration_date === 'string') updates.expiration_date = payload.expiration_date;
  if (typeof payload.coverage_summary === 'string') updates.coverage_summary = payload.coverage_summary.trim() || null;
  if (typeof payload.file_path === 'string') updates.file_path = payload.file_path.trim() || null;
  if (typeof payload.is_master === 'boolean') updates.is_master = payload.is_master;
  if (typeof payload.master_template_id === 'string' || payload.master_template_id === null) updates.master_template_id = payload.master_template_id ? payload.master_template_id.trim() : null;
  if (typeof payload.status === 'string') updates.status = payload.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase.from('certificates').update(updates).eq('id', payload.id).select('*').single();
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

  const { error } = await supabase.from('certificates').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
