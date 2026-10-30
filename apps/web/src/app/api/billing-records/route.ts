import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

interface BillingRecordPayload {
  id?: string;
  policy_id?: string;
  account_id?: string;
  invoice_date?: string;
  due_date?: string;
  amount?: number | string;
  status?: 'paid' | 'pending' | 'overdue' | 'returned';
  payment_method?: string | null;
  commission_percent?: number | string;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeAmount(value: number | string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveAccountId(policyId: string): Promise<{ accountId: string | null; error: string | null }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { accountId: null, error: 'Supabase is not configured.' };

  const { data, error } = await supabase.from('policies').select('account_id,client_id').eq('id', policyId).maybeSingle();
  if (error) return { accountId: null, error: error.message };
  return { accountId: data?.account_id ?? data?.client_id ?? null, error: null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const accountId = normalizeText(request.nextUrl.searchParams.get('account_id'));
  const policyId = normalizeText(request.nextUrl.searchParams.get('policy_id'));
  const status = normalizeText(request.nextUrl.searchParams.get('status'));

  let query = supabase
    .from('billing_records')
    .select('id,policy_id,account_id,invoice_date,due_date,amount,status,payment_method,commission_percent,commission_amount,created_at,updated_at,policies(insured_name,carrier,policy_number,line_of_business,sub_type),clients(full_name)')
    .order('due_date', { ascending: true })
    .limit(300);

  if (accountId) query = query.eq('account_id', accountId);
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

  const payload = (await request.json().catch(() => ({}))) as BillingRecordPayload;
  const policyId = normalizeText(payload.policy_id);
  const amount = normalizeAmount(payload.amount);
  const commissionPercent = normalizeAmount(payload.commission_percent) ?? 0;

  if (!policyId || !payload.invoice_date || !payload.due_date || amount === null) {
    return NextResponse.json({ message: 'policy_id, invoice_date, due_date and amount are required.' }, { status: 400 });
  }

  let accountId = normalizeText(payload.account_id);
  if (!accountId) {
    const resolved = await resolveAccountId(policyId);
    if (resolved.error) return NextResponse.json({ message: resolved.error }, { status: 500 });
    accountId = resolved.accountId;
  }

  if (!accountId) {
    return NextResponse.json({ message: 'Unable to resolve account for billing record.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('billing_records')
    .insert([
      {
        policy_id: policyId,
        account_id: accountId,
        invoice_date: payload.invoice_date,
        due_date: payload.due_date,
        amount,
        status: payload.status ?? 'pending',
        payment_method: normalizeText(payload.payment_method ?? null),
        commission_percent: commissionPercent,
      },
    ])
    .select('id,policy_id,account_id,invoice_date,due_date,amount,status,payment_method,commission_percent,commission_amount,created_at,updated_at')
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

  const payload = (await request.json().catch(() => ({}))) as BillingRecordPayload;
  const id = normalizeText(payload.id);
  if (!id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | number | null> = {};
  if (typeof payload.policy_id === 'string') updates.policy_id = payload.policy_id;
  if (typeof payload.account_id === 'string') updates.account_id = payload.account_id;
  if (typeof payload.invoice_date === 'string') updates.invoice_date = payload.invoice_date;
  if (typeof payload.due_date === 'string') updates.due_date = payload.due_date;
  if (Object.prototype.hasOwnProperty.call(payload, 'amount')) updates.amount = normalizeAmount(payload.amount);
  if (payload.status) updates.status = payload.status;
  if (Object.prototype.hasOwnProperty.call(payload, 'payment_method')) updates.payment_method = normalizeText(payload.payment_method ?? null);
  if (Object.prototype.hasOwnProperty.call(payload, 'commission_percent')) updates.commission_percent = normalizeAmount(payload.commission_percent) ?? 0;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('billing_records')
    .update(updates)
    .eq('id', id)
    .select('id,policy_id,account_id,invoice_date,due_date,amount,status,payment_method,commission_percent,commission_amount,created_at,updated_at')
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

  const { error } = await supabase.from('billing_records').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
