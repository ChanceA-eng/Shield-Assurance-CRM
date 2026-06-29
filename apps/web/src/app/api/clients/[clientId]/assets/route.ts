import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface AssetPayload {
  id?: string;
  title?: string;
  asset_type?: string;
  value?: string;
  metadata?: Record<string, unknown>;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const { data, error } = await supabase
    .from('client_assets')
    .select('id,client_id,title,asset_type,value,metadata,created_at,updated_at')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
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
  const payload = (await request.json()) as AssetPayload;
  if (!payload.title?.trim()) {
    return NextResponse.json({ message: 'title is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('client_assets')
    .insert([
      {
        client_id: clientId,
        title: payload.title.trim(),
        asset_type: payload.asset_type?.trim() || 'general',
        value: payload.value?.trim() || null,
        metadata: payload.metadata ?? {},
      },
    ])
    .select('id,client_id,title,asset_type,value,metadata,created_at,updated_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const payload = (await request.json()) as AssetPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof payload.title === 'string') updates.title = payload.title.trim();
  if (typeof payload.asset_type === 'string') updates.asset_type = payload.asset_type.trim() || 'general';
  if (typeof payload.value === 'string') updates.value = payload.value.trim() || null;
  if (payload.metadata && typeof payload.metadata === 'object') updates.metadata = payload.metadata;

  const { data, error } = await supabase
    .from('client_assets')
    .update(updates)
    .eq('id', payload.id)
    .eq('client_id', clientId)
    .select('id,client_id,title,asset_type,value,metadata,created_at,updated_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('client_assets').delete().eq('id', payload.id).eq('client_id', clientId);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
