import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const read = request.nextUrl.searchParams.get('read');
  const clientId = request.nextUrl.searchParams.get('client_id') ?? request.nextUrl.searchParams.get('contact_id');
  let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (read === 'true') query = query.eq('read', true);
  if (read === 'false') query = query.eq('read', false);
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

  const payload = (await request.json()) as { client_id?: string; type?: string; message?: string };
  if (!payload.type || !payload.message) {
    return NextResponse.json({ message: 'type and message are required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert([
      {
        client_id: payload.client_id ?? null,
        type: payload.type,
        message: payload.message,
        read: false,
      },
    ])
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
