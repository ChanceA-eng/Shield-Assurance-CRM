import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

function isClientOrContactId(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('client_id') ?? request.nextUrl.searchParams.get('contact_id');
  let query = supabase.from('scheduled_messages').select('*').order('send_at', { ascending: true }).limit(100);
  if (isClientOrContactId(clientId)) {
    query = query.eq('client_id', clientId);
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

  const payload = (await request.json()) as {
    client_id?: string;
    send_at?: string;
    channel?: 'email' | 'sms';
    subject?: string;
    body?: string;
    automation_type?: string;
    status?: string;
  };

  if (!payload.client_id || !payload.send_at || !payload.channel || !payload.body || !payload.automation_type) {
    return NextResponse.json({ message: 'client_id, send_at, channel, body and automation_type are required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert([
      {
        client_id: payload.client_id,
        send_at: payload.send_at,
        channel: payload.channel,
        subject: payload.subject?.trim() || null,
        body: payload.body,
        automation_type: payload.automation_type,
        status: payload.status?.trim() || 'pending',
      },
    ])
    .select('*')
    .single();

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

  const payload = (await request.json()) as {
    id?: string;
    send_at?: string;
    channel?: 'email' | 'sms';
    subject?: string;
    body?: string;
    status?: string;
    automation_type?: string;
  };

  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (typeof payload.send_at === 'string') updates.send_at = payload.send_at;
  if (typeof payload.channel === 'string') updates.channel = payload.channel;
  if (typeof payload.subject === 'string') updates.subject = payload.subject.trim();
  if (typeof payload.body === 'string') updates.body = payload.body;
  if (typeof payload.status === 'string') updates.status = payload.status.trim();
  if (typeof payload.automation_type === 'string') updates.automation_type = payload.automation_type.trim();

  const { data, error } = await supabase.from('scheduled_messages').update(updates).eq('id', payload.id).select('*').single();
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

  const { error } = await supabase.from('scheduled_messages').delete().eq('id', payload.id);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}