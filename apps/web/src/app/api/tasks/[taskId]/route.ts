import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface TaskUpdatePayload {
  subject?: string;
  description?: string;
  due_date?: string;
  status?: string;
  priority?: string;
  related_type?: string;
  related_id?: string;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { taskId } = await context.params;
  const payload = (await request.json()) as TaskUpdatePayload;

  const updates: TaskUpdatePayload = {};
  if (typeof payload.subject === 'string') updates.subject = payload.subject.trim();
  if (typeof payload.description === 'string') updates.description = payload.description.trim();
  if (typeof payload.due_date === 'string') updates.due_date = payload.due_date;
  if (typeof payload.status === 'string') updates.status = payload.status.trim();
  if (typeof payload.priority === 'string') updates.priority = payload.priority.trim();
  if (typeof payload.related_type === 'string') updates.related_type = payload.related_type.trim();
  if (typeof payload.related_id === 'string') updates.related_id = payload.related_id.trim();

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
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
