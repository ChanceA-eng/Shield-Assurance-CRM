import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface TagPayload {
  id?: string;
  tag?: string;
  color?: string;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const { data, error } = await supabase
    .from('client_tags')
    .select('id,client_id,tag,color,created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(200);

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
  const payload = (await request.json()) as TagPayload;
  const tag = payload.tag?.trim();
  if (!tag) {
    return NextResponse.json({ message: 'tag is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('client_tags')
    .upsert(
      [
        {
          client_id: clientId,
          tag,
          color: payload.color?.trim() || null,
        },
      ],
      { onConflict: 'client_id,tag' },
    )
    .select('id,client_id,tag,color,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const payload = (await request.json()) as TagPayload;

  if (payload.id) {
    const { error } = await supabase.from('client_tags').delete().eq('id', payload.id).eq('client_id', clientId);
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const tag = payload.tag?.trim();
  if (!tag) {
    return NextResponse.json({ message: 'id or tag is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('client_tags').delete().eq('client_id', clientId).eq('tag', tag);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
