import { NextRequest, NextResponse } from 'next/server';
import { getApiSession, apiActorName } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { absoluteDateTime, isRecord, isUuid } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { assertAppointmentTaskAccess } from '../../../../lib/appointment-lifecycle';

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    const due = absoluteDateTime(body.due_date);
    if (!due) throw new WorkspaceError('Choose a valid new due date and time with a timezone.', 400);
    if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 200) throw new WorkspaceError('Select between 1 and 200 open tasks.', 400);
    const ids = new Set<string>();
    const tasks = body.tasks.map((task: unknown) => {
      if (!isRecord(task) || !isUuid(task.id) || !absoluteDateTime(task.expected_updated_at)) throw new WorkspaceError('Each selected task needs a valid ID and saved version. Refresh tasks before selecting.', 400);
      const id = task.id.toLowerCase();
      if (ids.has(id)) throw new WorkspaceError('Select each task only once.', 400);
      ids.add(id);
      return { id, expected_updated_at: task.expected_updated_at };
    });
    const selected = await db.from('tasks').select('id,event_id,related_type,related_id').in('id', [...ids]);
    if (selected.error) throw databaseError(selected.error);
    for (const task of selected.data ?? []) await assertAppointmentTaskAccess(db, session.user.id, task, { due_date: due });
    const saved = await db.rpc('bulk_reschedule_tasks', { p_tasks: tasks, p_due_date: due, p_actor: apiActorName(session.user) });
    if (saved.error) throw databaseError(saved.error);
    if (!Array.isArray(saved.data) || saved.data.length !== tasks.length) throw new WorkspaceError('The reschedule result could not be verified. Refresh tasks before retrying.', 503);
    return NextResponse.json({ updated: saved.data.length, tasks: saved.data });
  } catch (error) { return workspaceApiError(error, 'tasks/bulk-reschedule'); }
}
