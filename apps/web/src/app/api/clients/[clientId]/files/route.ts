import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface ClientFilePayload {
  id?: string;
  file_name?: string;
  file_url?: string;
  file_type?: string;
  file_size?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const { data, error } = await supabase
    .from('client_files')
    .select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at')
    .eq('client_id', clientId)
    .order('uploaded_at', { ascending: false })
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
  const payload = (await request.json()) as ClientFilePayload;
  if (!payload.file_name?.trim()) {
    return NextResponse.json({ message: 'file_name is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('client_files')
    .insert([
      {
        client_id: clientId,
        file_name: payload.file_name.trim(),
        file_url: payload.file_url?.trim() || null,
        file_type: payload.file_type?.trim() || null,
        file_size: typeof payload.file_size === 'number' ? payload.file_size : null,
        status: payload.status?.trim() || 'uploaded',
        metadata: payload.metadata ?? {},
      },
    ])
    .select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at')
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
  const payload = (await request.json()) as ClientFilePayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof payload.file_name === 'string') updates.file_name = payload.file_name.trim();
  if (typeof payload.file_url === 'string') updates.file_url = payload.file_url.trim() || null;
  if (typeof payload.file_type === 'string') updates.file_type = payload.file_type.trim() || null;
  if (typeof payload.file_size === 'number') updates.file_size = payload.file_size;
  if (typeof payload.status === 'string') updates.status = payload.status.trim() || 'uploaded';
  if (payload.metadata && typeof payload.metadata === 'object') updates.metadata = payload.metadata;

  const { data, error } = await supabase
    .from('client_files')
    .update(updates)
    .eq('id', payload.id)
    .eq('client_id', clientId)
    .select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at')
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

  const { error } = await supabase.from('client_files').delete().eq('id', payload.id).eq('client_id', clientId);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
