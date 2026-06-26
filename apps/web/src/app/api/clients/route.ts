import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

interface NewClientPayload {
  id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  email_consent?: boolean;
  sms_consent?: boolean;
  preferred_channel?: string;
}

function isColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const value = message.toLowerCase();
  return value.includes('column') || value.includes('schema cache') || value.includes('does not exist');
}

export async function GET(): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const queryResult = await supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,email_consent,sms_consent,preferred_channel,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (queryResult.error && isColumnError(queryResult.error.message)) {
    const fallbackQueryResult = await supabase
      .from('clients')
      .select('id,full_name,phone,email,address,source,email_consent,sms_consent,preferred_channel,created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (fallbackQueryResult.error) {
      return NextResponse.json({ message: fallbackQueryResult.error.message }, { status: 500 });
    }

    return NextResponse.json(fallbackQueryResult.data ?? [], { status: 200 });
  }

  const { data, error } = queryResult;

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
        email_consent: payload.email_consent ?? false,
        sms_consent: payload.sms_consent ?? false,
        preferred_channel: payload.preferred_channel?.trim() || 'email',
      },
    ])
    .select('*')
    .single();

  if (insertResult.error && isColumnError(insertResult.error.message)) {
    const fallbackInsertResult = await supabase
      .from('clients')
      .insert([
        {
          full_name: payload.full_name.trim(),
          phone: payload.phone?.trim() || null,
          email: payload.email?.trim() || null,
          address: payload.address?.trim() || null,
          source: payload.source?.trim() || null,
          email_consent: payload.email_consent ?? false,
          sms_consent: payload.sms_consent ?? false,
          preferred_channel: payload.preferred_channel?.trim() || 'email',
        },
      ])
      .select('*')
      .single();

    if (fallbackInsertResult.error) {
      return NextResponse.json({ message: fallbackInsertResult.error.message }, { status: 500 });
    }

    return NextResponse.json(fallbackInsertResult.data, { status: 201 });
  }

  const { data, error } = insertResult;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
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
  if (typeof payload.email_consent === 'boolean') updates.email_consent = payload.email_consent;
  if (typeof payload.sms_consent === 'boolean') updates.sms_consent = payload.sms_consent;
  if (typeof payload.preferred_channel === 'string') updates.preferred_channel = payload.preferred_channel.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const updateResult = await supabase.from('clients').update(updates).eq('id', payload.id).select('*').single();
  if (updateResult.error && isColumnError(updateResult.error.message)) {
    const { source: _source, ...fallbackUpdates } = updates;
    const fallbackUpdateResult = await supabase.from('clients').update(fallbackUpdates).eq('id', payload.id).select('*').single();

    if (fallbackUpdateResult.error) {
      return NextResponse.json({ message: fallbackUpdateResult.error.message }, { status: 500 });
    }

    return NextResponse.json(fallbackUpdateResult.data, { status: 200 });
  }

  const { data, error } = updateResult;
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

  const { error } = await supabase.from('clients').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
