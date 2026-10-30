import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';

interface NewClientPayload {
  id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  account_type?: 'unknown' | 'personal' | 'commercial';
  assigned_producer?: string | null;
  csr?: string | null;
  since_date?: string | null;
  email_consent?: boolean;
  sms_consent?: boolean;
  preferred_channel?: string;
  policy_effective_at?: string | null;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const actionableCount = request.nextUrl.searchParams.get('actionableCount') === 'true';

  if (actionableCount) {
    const { data, error } = await supabase.rpc('get_actionable_clients_count');
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ count: typeof data === 'number' ? data : 0 }, { status: 200 });
  }

  const queryResult = await supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel,created_at,policy_effective_at,last_viewed_at,last_activity_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const { data, error } = queryResult;

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

  const payload = (await request.json()) as NewClientPayload;

  if (!payload.full_name || payload.full_name.trim().length === 0) {
    return NextResponse.json({ message: 'full_name is required.' }, { status: 400 });
  }

  const insertResult = await supabase
    .from('clients')
    .insert([
      {
        full_name: payload.full_name.trim(),
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        source: payload.source?.trim() || null,
        account_type: payload.account_type ?? 'unknown',
        assigned_producer: payload.assigned_producer?.trim() || null,
        csr: payload.csr?.trim() || null,
        since_date: payload.since_date ?? null,
        email_consent: payload.email_consent ?? false,
        sms_consent: payload.sms_consent ?? false,
        preferred_channel: payload.preferred_channel?.trim() || 'email',
      },
    ])
    .select('*')
    .single();

  const { data, error } = insertResult;

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

  const payload = (await request.json()) as NewClientPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | boolean | null> = {};
  if (typeof payload.full_name === 'string') updates.full_name = payload.full_name.trim();
  if (typeof payload.phone === 'string') updates.phone = payload.phone.trim() || null;
  if (typeof payload.email === 'string') updates.email = payload.email.trim() || null;
  if (typeof payload.address === 'string') updates.address = payload.address.trim() || null;
  if (typeof payload.source === 'string') updates.source = payload.source.trim() || null;
  if (payload.account_type === 'unknown' || payload.account_type === 'personal' || payload.account_type === 'commercial') updates.account_type = payload.account_type;
  if (typeof payload.assigned_producer === 'string' || payload.assigned_producer === null) updates.assigned_producer = payload.assigned_producer?.trim() || null;
  if (typeof payload.csr === 'string' || payload.csr === null) updates.csr = payload.csr?.trim() || null;
  if (typeof payload.since_date === 'string' || payload.since_date === null) updates.since_date = payload.since_date;
  if (typeof payload.email_consent === 'boolean') updates.email_consent = payload.email_consent;
  if (typeof payload.sms_consent === 'boolean') updates.sms_consent = payload.sms_consent;
  if (typeof payload.preferred_channel === 'string') updates.preferred_channel = payload.preferred_channel.trim();
  if (Object.prototype.hasOwnProperty.call(payload, 'policy_effective_at')) {
    const policyEffectiveAt = normalizeIsoDate(payload.policy_effective_at);
    if (payload.policy_effective_at !== null && !policyEffectiveAt) {
      return NextResponse.json({ message: 'Invalid policy_effective_at value.' }, { status: 400 });
    }

    updates.policy_effective_at = policyEffectiveAt;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'last_viewed_at')) {
    const viewedAt = normalizeIsoDate(payload.last_viewed_at);
    if (payload.last_viewed_at !== null && !viewedAt) {
      return NextResponse.json({ message: 'Invalid last_viewed_at value.' }, { status: 400 });
    }

    updates.last_viewed_at = viewedAt;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'last_activity_at')) {
    const activityAt = normalizeIsoDate(payload.last_activity_at);
    if (payload.last_activity_at !== null && !activityAt) {
      return NextResponse.json({ message: 'Invalid last_activity_at value.' }, { status: 400 });
    }

    updates.last_activity_at = activityAt;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const updateResult = await supabase.from('clients').update(updates).eq('id', payload.id).select('*').single();
  const { data, error } = updateResult;
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

  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('clients').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
