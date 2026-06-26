import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('client_id') ?? request.nextUrl.searchParams.get('contact_id');
  let query = supabase.from('communication_log').select('*').order('sent_at', { ascending: false }).limit(100);
  if (clientId) query = query.eq('client_id', clientId);

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
    channel?: 'email' | 'sms';
    direction?: 'outbound' | 'inbound';
    subject?: string;
    body?: string;
    automation_type?: string;
  };

  if (!payload.channel || !payload.subject || !payload.body || !payload.automation_type) {
    return NextResponse.json({ message: 'channel, subject, body and automation_type are required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('communication_log')
    .insert([
      {
        client_id: payload.client_id ?? null,
        channel: payload.channel,
        direction: payload.direction ?? 'outbound',
        subject: payload.subject,
        body: payload.body,
        automation_type: payload.automation_type,
        sent_at: new Date().toISOString(),
      },
    ])
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
