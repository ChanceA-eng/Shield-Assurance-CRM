import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface ActivityPayload {
  activity_type?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const { data, error } = await supabase
    .from('client_activities')
    .select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at')
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const payload = (await request.json()) as ActivityPayload;
  if (!payload.activity_type?.trim() || !payload.title?.trim()) {
    return NextResponse.json({ message: 'activity_type and title are required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('client_activities')
    .insert([
      {
        client_id: clientId,
        activity_type: payload.activity_type.trim(),
        title: payload.title.trim(),
        body: payload.body?.trim() || null,
        metadata: payload.metadata ?? {},
        occurred_at: payload.occurred_at ?? new Date().toISOString(),
      },
    ])
    .select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
