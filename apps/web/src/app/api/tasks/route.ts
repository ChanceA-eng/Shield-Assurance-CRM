import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isRecordType, type WorkspaceTask } from '@crm/shared';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { endOfAgencyDay } from '../../../lib/agency-time';
import { parseTaskDueDate } from '../../../lib/task-timeliness';
import { getAgencyTimeZone } from '../../../lib/automation-settings';
import { absoluteDateTime, isUuid } from '../../../lib/workspace-validation';
import { namedTaskSubject, resolveRecordScope, taskFilter, WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { taskRecordHref } from '../../../lib/task-links';
import { assertAppointmentTaskAccess } from '../../../lib/appointment-lifecycle';
import type { RequestAccess } from '../../../lib/team-request-access';

type TaskScope = 'agency' | 'assigned' | 'self';

function taskScope(access: RequestAccess | undefined, permission: 'tasks.view' | 'tasks.edit'): TaskScope | null {
  if (access?.mode === 'legacy') return 'agency';
  const scope = access?.mode === 'restricted' ? access.grants[permission] : null;
  return scope === 'agency' || scope === 'assigned' || scope === 'self' ? scope : null;
}

async function isAssignedRecord(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string, type: string, id: string): Promise<boolean> {
  if (type !== 'lead' && type !== 'client') return false;
  const result = await db.from(type === 'lead' ? 'leads' : 'clients').select('id')
    .eq('id', id).eq('agent_user_id', actor).maybeSingle();
  if (result.error) throw databaseError(result.error);
  return Boolean(result.data);
}

async function assertTaskScope(
  db: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  actor: string,
  scope: TaskScope,
  task: Pick<WorkspaceTask, 'created_by_user_id' | 'related_type' | 'related_id' | 'account_id'>,
): Promise<void> {
  if (scope === 'agency') return;
  if (scope === 'self' && task.created_by_user_id === actor && !task.related_id && !task.account_id) return;
  if (scope === 'assigned' && task.created_by_user_id === actor && !task.related_id && !task.account_id) return;
  if (scope === 'self') throw new WorkspaceError('This task is outside your access.', 403);
  if ((task.related_type && task.related_id && await isAssignedRecord(db, actor, task.related_type, task.related_id))
    || (task.account_id && await isAssignedRecord(db, actor, 'client', task.account_id))) return;
  throw new WorkspaceError('This task is outside your assigned records.', 403);
}

async function assignedTaskFilter(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string): Promise<string> {
  const [clients, leads] = await Promise.all([
    db.from('clients').select('id').eq('agent_user_id', actor),
    db.from('leads').select('id').eq('agent_user_id', actor),
  ]);
  if (clients.error) throw databaseError(clients.error);
  if (leads.error) throw databaseError(leads.error);
  const clauses = [`and(created_by_user_id.eq.${actor},related_id.is.null,account_id.is.null)`];
  const clientIds = (clients.data ?? []).map(({ id }) => id);
  const leadIds = (leads.data ?? []).map(({ id }) => id);
  if (clientIds.length) clauses.push(`account_id.in.(${clientIds.join(',')})`);
  if (leadIds.length) clauses.push(`and(related_type.eq.lead,related_id.in.(${leadIds.join(',')}))`);
  return clauses.join(',');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const scope = taskScope(session.teamAccess, 'tasks.view');
    if (!scope) throw new WorkspaceError('You do not have access to tasks.', 403);
    const params = request.nextUrl.searchParams;
    const status = params.get('status') ?? 'all';
    const sort = params.get('sort') ?? 'due_asc';
    const countOnly = params.get('count') === 'true';
    const rawLimit = Number(params.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 20;
    const offset = Number(params.get('offset') ?? '0');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceError('Invalid task offset.', 400);
    const recordHistory = Boolean(params.get('record_id') || params.get('related_id'));
    if (scope === 'self' && recordHistory) throw new WorkspaceError('Personal tasks cannot be filtered by CRM records.', 403);
    let query = supabase.from(recordHistory ? 'tasks' : 'active_workspace_tasks').select('*', { count: 'exact', head: countOnly });
    if (scope === 'self') query = query.eq('created_by_user_id', session.user.id);
    if (scope === 'assigned' && !recordHistory) query = query.or(await assignedTaskFilter(supabase, session.user.id));
    if (status === 'open' || status === 'completed') query = query.eq('status', status);
    else if (status === 'overdue') query = query.eq('status', 'open').lt('due_date', new Date().toISOString());
    else if (status !== 'all') throw new WorkspaceError('Invalid task status filter.', 400);
    if (params.get('due') === 'today') {
      const timezone = await getAgencyTimeZone(supabase);
      query = query.lt('due_date', endOfAgencyDay(new Date(), timezone).toISOString());
    }
    if (params.get('kind')) query = query.eq('kind', params.get('kind'));

    const recordType = params.get('record_type');
    const recordId = params.get('record_id');
    if (recordType || recordId) {
      if (!isRecordType(recordType) || !isUuid(recordId)) throw new WorkspaceError('A valid lead or client is required.', 400);
      if (scope === 'assigned' && !(await isAssignedRecord(supabase, session.user.id, recordType, recordId))) {
        throw new WorkspaceError('This record is outside your assignment.', 404);
      }
      query = query.or(taskFilter(await resolveRecordScope(supabase, { type: recordType, id: recordId })));
    } else {
      if (params.get('related_id')) {
        if (!isUuid(params.get('related_id'))) throw new WorkspaceError('Invalid related record id.', 400);
        const relatedType = params.get('related_type');
        if (scope !== 'agency') {
          if (!relatedType || (relatedType !== 'event' && !(await isAssignedRecord(supabase, session.user.id, relatedType, params.get('related_id')!)))) {
            throw new WorkspaceError('Choose a record within your task access.', 404);
          }
          if (relatedType === 'event') {
            const event = await supabase.from('events').select('id,client_id').eq('id', params.get('related_id')!)
              .eq('user_id', session.user.id).maybeSingle();
            if (event.error) throw databaseError(event.error);
            if (!event.data) throw new WorkspaceError('Appointment not found.', 404);
            if (scope === 'assigned' && event.data.client_id
              && !(await isAssignedRecord(supabase, session.user.id, 'client', event.data.client_id))) {
              throw new WorkspaceError('This appointment is outside your assigned records.', 404);
            }
          }
        }
        query = query.eq('related_id', params.get('related_id'));
      }
      if (params.get('related_type')) query = query.eq('related_type', params.get('related_type'));
    }
    if (sort === 'completed_desc') query = query.order('completed_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    else if (sort === 'created_desc') query = query.order('created_at', { ascending: false });
    else if (sort === 'due_desc') query = query.order('due_date', { ascending: false, nullsFirst: false });
    else query = query.order('due_date', { ascending: true, nullsFirst: false });
    const { data, count, error } = await query.order('id').range(offset, offset + limit - 1);
    if (error) throw databaseError(error);
    if (countOnly) return NextResponse.json({ count: count ?? 0 });
    const rows = (data ?? []) as WorkspaceTask[];
    if (params.get('include') === 'related' && rows.length) {
      const leadIds = [...new Set(rows.filter((row) => row.related_type === 'lead' && row.related_id).map((row) => row.related_id!))];
      const accountByTask = new Map<string, string>();
      const eventNames = new Map<string, string>();
      for (const [relatedType, table] of [
        ['policy', 'policies'], ['renewal_pipeline', 'policies'], ['claim', 'claims'],
        ['endorsement', 'endorsements'], ['certificate', 'certificates'],
      ] as const) {
        const ids = rows.filter((row) => row.related_type === relatedType && row.related_id).map((row) => row.related_id!);
        if (!ids.length) continue;
        const result = await supabase.from(table).select('id,client_id').in('id', ids);
        if (result.error) throw databaseError(result.error);
        for (const row of rows.filter((item) => item.related_type === relatedType)) {
          const record = result.data?.find((item) => item.id === row.related_id);
          if (record?.client_id) accountByTask.set(row.id, record.client_id);
        }
      }
      const requestTasks = rows.filter((row) => row.related_type === 'policy_change_request' && row.related_id);
      if (requestTasks.length) {
        const requests = await supabase.from('policy_change_requests')
          .select('id,policy_id')
          .in('id', requestTasks.map((row) => row.related_id!));
        if (requests.error) throw databaseError(requests.error);
        const policies = requests.data?.length
          ? await supabase.from('policies').select('id,client_id')
            .in('id', requests.data.map((item) => item.policy_id))
          : { data: [], error: null };
        if (policies.error) throw databaseError(policies.error);
        const accountByPolicy = new Map((policies.data ?? []).map((policy) => [policy.id, policy.client_id]));
        for (const row of requestTasks) {
          const requestRecord = requests.data?.find((item) => item.id === row.related_id);
          const accountId = requestRecord ? accountByPolicy.get(requestRecord.policy_id) : undefined;
          if (accountId) accountByTask.set(row.id, accountId);
        }
      }
      const eventIds = rows.filter((row) => row.related_type === 'event' && row.related_id).map((row) => row.related_id!);
      if (eventIds.length) {
        const events = await supabase.from('events').select('id,title,subject,client_id').in('id', eventIds);
        if (events.error) throw databaseError(events.error);
        for (const event of events.data ?? []) {
          eventNames.set(event.id, event.title || event.subject || 'Appointment');
          const task = rows.find((row) => row.related_type === 'event' && row.related_id === event.id);
          if (task && event.client_id) accountByTask.set(task.id, event.client_id);
        }
      }
      const clientIds = [...new Set(rows.flatMap((row) => {
        const id = row.related_type === 'client' ? row.related_id : accountByTask.get(row.id) ?? row.account_id;
        return id ? [id] : [];
      }))];
      const [leads, clients] = await Promise.all([
        leadIds.length ? supabase.from('leads').select('id,full_name,status').in('id', leadIds) : Promise.resolve({ data: [], error: null }),
        clientIds.length ? supabase.from('clients').select('id,full_name').in('id', clientIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (leads.error) throw databaseError(leads.error);
      if (clients.error) throw databaseError(clients.error);
      const names = new Map<string, { name: string; status?: string }>();
      for (const lead of leads.data ?? []) names.set(`lead:${lead.id}`, { name: lead.full_name, status: lead.status });
      for (const client of clients.data ?? []) names.set(`client:${client.id}`, { name: client.full_name });
      return NextResponse.json(rows.map((row) => {
        const accountId = accountByTask.get(row.id) ?? row.account_id;
        const record = names.get(`${row.related_type}:${row.related_id}`) ?? names.get(`client:${accountId}`);
        return {
          ...row, account_id: accountId, related_name: record?.name ?? eventNames.get(row.related_id ?? '') ?? null,
          related_status: record?.status ?? null, related_href: taskRecordHref({ ...row, account_id: accountId }),
        };
      }), { headers: { 'X-Total-Count': String(count ?? 0) } });
    }
    return NextResponse.json(rows, { headers: { 'X-Total-Count': String(count ?? 0) } });
  } catch (error) {
    return workspaceApiError(error, 'tasks/get');
  }
}

function priorityOf(value: unknown): string {
  if (value !== 'low' && value !== 'medium' && value !== 'high') throw new WorkspaceError('Choose low, medium or high priority.', 400);
  return value;
}

function statusOf(value: unknown): string {
  if (value !== 'open' && value !== 'completed') throw new WorkspaceError('Choose open or completed status.', 400);
  return value;
}

function assigneeOf(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 120 || !value.trim()) throw new WorkspaceError('Enter an assignee name of at most 120 characters, or leave unassigned.', 400);
  return value.trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    const scope = taskScope(session.teamAccess, 'tasks.edit');
    if (!scope) throw new WorkspaceError('You do not have access to manage tasks.', 403);
    let subject = typeof body.subject === 'string' ? body.subject.trim() : typeof body.title === 'string' ? body.title.trim() : '';
    if (!subject || subject.length > 240) throw new WorkspaceError('Enter an action of at most 240 characters.', 400);
    const kind = body.kind ?? 'task';
    if (kind !== 'task' && kind !== 'reminder') throw new WorkspaceError('Invalid task type.', 400);
    const due = body.due_date === undefined ? null : await parseTaskDueDate(body.due_date, () => getAgencyTimeZone(supabase));
    if (kind === 'reminder' && !due) throw new WorkspaceError('Reminders need a date and time.', 400);
    const relatedType = typeof body.related_type === 'string' ? body.related_type : null;
    const relatedId = body.related_id ?? null;
    if (scope === 'self' && (relatedType || relatedId)) throw new WorkspaceError('Personal tasks cannot be linked to CRM records.', 403);
    if (relatedType === 'event') throw new WorkspaceError('Create appointments from Calendar; their linked tasks are created automatically.', 400);
    if ((relatedType === null) !== (relatedId === null) || (relatedId !== null && !isUuid(relatedId))) throw new WorkspaceError('Choose a valid related record.', 400);
    let accountId: string | null = null;
    if (isRecordType(relatedType) && isUuid(relatedId)) {
      if (scope === 'assigned' && !(await isAssignedRecord(supabase, session.user.id, relatedType, relatedId))) {
        throw new WorkspaceError('Choose a record assigned to you.', 403);
      }
      const recordScope = await resolveRecordScope(supabase, { type: relatedType, id: relatedId });
      subject = namedTaskSubject(recordScope.name, subject);
      accountId = recordScope.clientId;
    }
    if (scope !== 'agency' && body.assignee !== undefined
      && session.teamAccess?.mode === 'restricted' && session.teamAccess.grants['tasks.assign'] !== 'agency') {
      throw new WorkspaceError('You need task assignment access to assign this task.', 403);
    }
    if (body.id !== undefined && !isUuid(body.id)) throw new WorkspaceError('Invalid task save id.', 400);
    const id = typeof body.id === 'string' ? body.id : randomUUID();
    const input = {
      id, subject, description: typeof body.description === 'string' ? body.description.trim() || null : null,
      due_date: due, kind, status: statusOf(body.status ?? 'open'), priority: priorityOf(body.priority ?? 'medium'),
      related_type: relatedType, related_id: relatedId, account_id: accountId, created_by: apiActorName(session.user),
      created_by_user_id: session.user.id,
      assignee: assigneeOf(body.assignee ?? null),
    };
    const { data, error } = await supabase.from('tasks').insert(input).select('*').single<WorkspaceTask>();
    if (error?.code === '23505') {
      const existing = await supabase.from('tasks').select('*').eq('id', id).maybeSingle<WorkspaceTask>();
      if (existing.error) throw databaseError(existing.error);
      if (existing.data) await assertTaskScope(supabase, session.user.id, scope, existing.data);
      if (existing.data?.subject === subject && existing.data.related_type === relatedType && existing.data.related_id === relatedId
        && existing.data.kind === kind && existing.data.description === input.description && existing.data.priority === input.priority
        && (existing.data.assignee ?? null) === input.assignee
        && (due === null ? existing.data.due_date === null : absoluteDateTime(existing.data.due_date) === due)) {
        return NextResponse.json(existing.data);
      }
      throw new WorkspaceError('This save id already belongs to another task. Refresh before trying again.', 409);
    }
    if (error) throw databaseError(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'tasks/post');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('A valid task id is required.', 400);
    const existing = await supabase.from('tasks').select('*').eq('id', body.id).maybeSingle<WorkspaceTask>();
    if (existing.error) throw databaseError(existing.error);
    if (!existing.data) throw new WorkspaceError('Task not found.', 404);
    const scope = taskScope(session.teamAccess, 'tasks.edit');
    if (!scope) throw new WorkspaceError('You do not have access to manage tasks.', 403);
    await assertTaskScope(supabase, session.user.id, scope, existing.data);
    if (body.assignee !== undefined && session.teamAccess?.mode === 'restricted'
      && session.teamAccess.grants['tasks.assign'] !== 'agency') {
      throw new WorkspaceError('You need task assignment access to assign this task.', 403);
    }
    await assertAppointmentTaskAccess(supabase, session.user.id, existing.data, body);
    const updates: Record<string, unknown> = { updated_by: apiActorName(session.user) };
    if (body.status !== undefined) updates.status = statusOf(body.status);
    if (body.priority !== undefined) updates.priority = priorityOf(body.priority);
    if (body.due_date !== undefined) updates.due_date = await parseTaskDueDate(body.due_date, () => getAgencyTimeZone(supabase));
    if (body.assignee !== undefined) updates.assignee = assigneeOf(body.assignee);
    if (body.subject !== undefined) {
      if (typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 240) throw new WorkspaceError('Enter a valid task action.', 400);
      updates.subject = body.subject.trim();
      if (isRecordType(existing.data.related_type) && existing.data.related_id) {
        const scope = await resolveRecordScope(supabase, { type: existing.data.related_type, id: existing.data.related_id });
        updates.subject = namedTaskSubject(scope.name, body.subject);
      }
    }
    if (typeof body.description === 'string') updates.description = body.description.trim() || null;
    if (Object.keys(updates).length === 1) throw new WorkspaceError('No task changes were provided.', 400);
    let query = supabase.from('tasks').update(updates).eq('id', body.id);
    if (typeof body.expected_updated_at === 'string') query = query.eq('updated_at', body.expected_updated_at);
    const { data, error } = await query.select('*').maybeSingle<WorkspaceTask>();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This task changed or no longer exists. Refresh before editing.', 409);
    return NextResponse.json(data);
  } catch (error) {
    return workspaceApiError(error, 'tasks/patch');
  }
}
