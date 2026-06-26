import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface NewTaskPayload {
  title?: string;
  subject?: string;
  description?: string;
  due_date?: string;
  status?: string;
  priority?: string;
  related_type?: string;
  related_id?: string;
}

interface UpdateTaskPayload {
  id?: string;
  status?: string;
  subject?: string;
  description?: string;
  due_date?: string;
  priority?: string;
  related_type?: string;
  related_id?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status') ?? 'all';
  const sort = searchParams.get('sort') ?? 'due_asc';
  const due = searchParams.get('due');
  const relatedId = searchParams.get('related_id');
  const relatedType = searchParams.get('related_type');

  let query = supabase
    .from('tasks')
    .select('*')
    .limit(20);

  if (status === 'open') {
    query = query.eq('status', 'open');
  } else if (status === 'completed') {
    query = query.eq('status', 'completed');
  } else if (status === 'overdue') {
    query = query.eq('status', 'open').lt('due_date', todayISO());
  }

  if (due === 'today') {
    query = query.lte('due_date', todayISO());
  }

  if (relatedId) {
    query = query.eq('related_id', relatedId);
  }

  if (relatedType) {
    query = query.eq('related_type', relatedType);
  }

  if (sort === 'due_desc') {
    query = query.order('due_date', { ascending: false, nullsFirst: false });
  } else if (sort === 'priority') {
    query = query.order('priority', { ascending: false, nullsFirst: false }).order('due_date', { ascending: true, nullsFirst: false });
  } else if (sort === 'created_desc') {
    query = query.order('created_at', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('due_date', { ascending: true, nullsFirst: false });
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

  const payload = (await request.json()) as NewTaskPayload;
  const subject = payload.subject?.trim() || payload.title?.trim() || '';
  if (!subject) {
    return NextResponse.json({ message: 'title or subject is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert([
      {
        subject,
        description: payload.description?.trim() || null,
        due_date: payload.due_date || null,
        status: payload.status?.trim() || 'open',
        priority: payload.priority?.trim() || 'medium',
        related_type: payload.related_type?.trim() || null,
        related_id: payload.related_id?.trim() || null,
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

  const payload = (await request.json()) as UpdateTaskPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updateData: Record<string, string | null> = {};
  if (typeof payload.status === 'string') updateData.status = payload.status;
  if (typeof payload.subject === 'string') updateData.subject = payload.subject.trim();
  if (typeof payload.description === 'string') updateData.description = payload.description.trim();
  if (typeof payload.due_date === 'string') updateData.due_date = payload.due_date;
  if (typeof payload.priority === 'string') updateData.priority = payload.priority;
  if (typeof payload.related_type === 'string') updateData.related_type = payload.related_type;
  if (typeof payload.related_id === 'string') updateData.related_id = payload.related_id;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', payload.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  const statusChanged = typeof payload.status === 'string';
  const linkedEventId =
    (typeof data?.event_id === 'string' && data.event_id) ||
    (typeof data?.related_type === 'string' && data.related_type === 'event' && typeof data?.related_id === 'string'
      ? data.related_id
      : '');

  if (statusChanged && linkedEventId) {
    const eventStatus = payload.status === 'completed' ? 'completed' : 'scheduled';
    await supabase.from('events').update({ status: eventStatus }).eq('id', linkedEventId);
  }

  return NextResponse.json(data, { status: 200 });
}
