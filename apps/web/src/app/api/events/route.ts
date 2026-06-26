import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { writeNotification, writeCommunicationLog } from '../../../lib/automation';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface NewEventPayload {
  client_id?: string;
  title?: string;
  subject?: string;
  description?: string;
  event_date?: string;
  event_time?: string;
  all_day?: boolean;
  status?: string;
  related_type?: string;
  related_id?: string;
}

interface UpdateEventPayload {
  id?: string;
  client_id?: string;
  title?: string;
  subject?: string;
  description?: string;
  event_date?: string;
  event_time?: string;
  all_day?: boolean;
  status?: string;
  related_type?: string;
  related_id?: string;
}

function isColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const value = message.toLowerCase();
  return value.includes('column') || value.includes('schema cache') || value.includes('does not exist');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const order = request.nextUrl.searchParams.get('order') ?? 'asc';
  const status = request.nextUrl.searchParams.get('status') ?? 'scheduled';
  const rangeStart = request.nextUrl.searchParams.get('start');
  const rangeEnd = request.nextUrl.searchParams.get('end');
  const relatedId = request.nextUrl.searchParams.get('related_id');
  const relatedType = request.nextUrl.searchParams.get('related_type');
  const clientId = request.nextUrl.searchParams.get('client_id');

  let query = supabase.from('events').select('*').order('event_date', { ascending: order !== 'desc' }).limit(250);

  if (rangeStart) {
    query = query.gte('event_date', rangeStart);
  } else {
    query = query.gte('event_date', todayISO());
  }

  if (rangeEnd) {
    query = query.lte('event_date', rangeEnd);
  }

  if (relatedId) {
    query = query.eq('related_id', relatedId);
  }

  if (relatedType) {
    query = query.eq('related_type', relatedType);
  }

  if (clientId) {
    query = query.eq('client_id', clientId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const filtered =
    status === 'all'
      ? rows
      : rows.filter((row) => {
          const rowStatus = typeof row.status === 'string' ? row.status : 'scheduled';
          return rowStatus === status;
        });

  return NextResponse.json(filtered, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewEventPayload;
  const subject = payload.subject?.trim() || payload.title?.trim() || '';
  if (!subject || !payload.event_date) {
    return NextResponse.json({ message: 'subject and event_date are required.' }, { status: 400 });
  }

  const eventInsert = {
    client_id: payload.client_id?.trim() || null,
    subject,
    title: subject,
    description: payload.description?.trim() || null,
    event_date: payload.event_date,
    event_time: payload.all_day ? null : payload.event_time || null,
    all_day: payload.all_day ?? !payload.event_time,
    status: payload.status?.trim() || 'scheduled',
    related_type: payload.related_type?.trim() || null,
    related_id: payload.related_id?.trim() || null,
  };

  const insertedEvent = await supabase
    .from('events')
    .insert([eventInsert])
    .select('*')
    .single();

  let event = insertedEvent.data;
  let insertError = insertedEvent.error;

  if (insertError && isColumnError(insertError.message)) {
    const fallbackInsert = await supabase
      .from('events')
      .insert([
        {
          client_id: payload.client_id?.trim() || null,
          subject,
          event_date: payload.event_date,
        },
      ])
      .select('*')
      .single();

    event = fallbackInsert.data;
    insertError = fallbackInsert.error;
  }

  if (insertError || !event) {
    return NextResponse.json({ message: insertError?.message ?? 'Failed to create event.' }, { status: 500 });
  }

  const taskInsert = await supabase
    .from('tasks')
    .insert([
      {
        subject,
        description: payload.description?.trim() || null,
        due_date: payload.event_date,
        status: event.status === 'completed' ? 'completed' : 'open',
        priority: 'medium',
        related_type: 'event',
        related_id: event.id,
      },
    ])
    .select('*')
    .single();

  if (!taskInsert.error && taskInsert.data?.id) {
    const taskLinkAttempt = await supabase.from('events').update({ task_id: taskInsert.data.id }).eq('id', event.id);
    if (!taskLinkAttempt.error) {
      event.task_id = taskInsert.data.id;
    }
  }

  await writeNotification({
    client_id: null,
    type: 'appointment',
    message: `Appointment created: ${subject}`,
  });

  await writeCommunicationLog({
    client_id: null,
    channel: 'email',
    subject: 'Appointment scheduled',
    body: `Your appointment ${subject} has been scheduled for ${payload.event_date}.`,
    automation_type: 'appointment',
  });

  return NextResponse.json(event, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as UpdateEventPayload;
  if (!payload.id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | boolean | null> = {};
  if (typeof payload.subject === 'string') {
    updates.subject = payload.subject.trim();
    updates.title = payload.subject.trim();
  }
  if (typeof payload.title === 'string' && !updates.subject) {
    updates.subject = payload.title.trim();
    updates.title = payload.title.trim();
  }
  if (typeof payload.description === 'string') updates.description = payload.description.trim();
  if (typeof payload.event_date === 'string') updates.event_date = payload.event_date;
  if (typeof payload.event_time === 'string') updates.event_time = payload.event_time;
  if (typeof payload.all_day === 'boolean') updates.all_day = payload.all_day;
  if (typeof payload.status === 'string') updates.status = payload.status.trim();
  if (typeof payload.client_id === 'string') updates.client_id = payload.client_id.trim();
  if (typeof payload.related_type === 'string') updates.related_type = payload.related_type.trim();
  if (typeof payload.related_id === 'string') updates.related_id = payload.related_id.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields were provided.' }, { status: 400 });
  }

  let updateResult = await supabase.from('events').update(updates).eq('id', payload.id).select('*').single();

  if (updateResult.error && isColumnError(updateResult.error.message)) {
    const minimalUpdates: Record<string, string> = {};
    if (typeof updates.subject === 'string') minimalUpdates.subject = updates.subject;
    if (typeof updates.event_date === 'string') minimalUpdates.event_date = updates.event_date;
    updateResult = await supabase.from('events').update(minimalUpdates).eq('id', payload.id).select('*').single();
  }

  const { data, error } = updateResult;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  const statusChanged = typeof payload.status === 'string';
  if (statusChanged) {
    const linkedTaskId = typeof data?.task_id === 'string' ? data.task_id : '';
    const taskStatus = payload.status === 'completed' ? 'completed' : 'open';
    if (linkedTaskId) {
      await supabase.from('tasks').update({ status: taskStatus }).eq('id', linkedTaskId);
    } else {
      await supabase.from('tasks').update({ status: taskStatus }).eq('related_type', 'event').eq('related_id', payload.id);
    }
  }

  return NextResponse.json(data, { status: 200 });
}
