import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface ClientTaskPayload {
  id?: string;
  subject?: string;
  description?: string;
  due_date?: string;
  status?: string;
  priority?: string;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const { data, error } = await supabase
    .from('client_tasks')
    .select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at')
    .eq('client_id', clientId)
    .order('due_date', { ascending: true, nullsFirst: false })
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
  const payload = (await request.json()) as ClientTaskPayload;
  if (!payload.subject?.trim()) {
    return NextResponse.json({ message: 'subject is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('client_tasks')
    .insert([
      {
        client_id: clientId,
        subject: payload.subject.trim(),
        description: payload.description?.trim() || null,
        due_date: payload.due_date || null,
        status: payload.status?.trim() || 'open',
        priority: payload.priority?.trim() || 'medium',
      },
    ])
    .select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at')
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
  const payload = (await request.json()) as ClientTaskPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() };
  if (typeof payload.subject === 'string') updates.subject = payload.subject.trim();
  if (typeof payload.description === 'string') updates.description = payload.description.trim() || null;
  if (typeof payload.due_date === 'string') updates.due_date = payload.due_date || null;
  if (typeof payload.status === 'string') updates.status = payload.status.trim() || 'open';
  if (typeof payload.priority === 'string') updates.priority = payload.priority.trim() || 'medium';

  const { data, error } = await supabase
    .from('client_tasks')
    .update(updates)
    .eq('id', payload.id)
    .eq('client_id', clientId)
    .select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at')
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

  const { error } = await supabase.from('client_tasks').delete().eq('id', payload.id).eq('client_id', clientId);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
