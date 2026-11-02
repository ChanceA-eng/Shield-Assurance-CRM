import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';
import { workdayFilters } from '../../../lib/workday';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    let filters: ReturnType<typeof workdayFilters>;
    try { filters = workdayFilters(request.nextUrl.searchParams); }
    catch (error) { throw new WorkspaceError(error instanceof Error ? error.message : 'Invalid work filters.', 400); }
    const sources = request.nextUrl.searchParams.get('sources');
    if (sources !== null && sources !== 'true') throw new WorkspaceError('Choose a valid source filter.', 400);
    // An intake already attached to a lead is not another unfinished request.
    let query = db.from('agent_workday').select('*', { count: 'exact' }).not('id', 'like', 'intake:%');
    let countQuery = db.from('agent_workday').select('id', { count: 'exact', head: true }).not('id', 'like', 'intake:%').eq('actionable', true);
    if (sources === 'true') {
      query = query.is('task_id', null);
      countQuery = countQuery.is('task_id', null);
    }
    if (filters.kind !== 'all') query = query.eq('kind', filters.kind);
    if (filters.timing !== 'all') query = query.eq('timing', filters.timing);
    if (filters.assignee === 'unassigned') query = query.is('assignee', null);
    else if (filters.assignee) query = query.eq('assignee', filters.assignee);
    const [rows, count] = await Promise.all([
      query.order('urgency').order('due_at', { nullsFirst: false }).order('id').range(filters.page * 25, filters.page * 25 + 24),
      countQuery,
    ]);
    if (rows.error) {
      if (rows.error.code === '42P01' || rows.error.code === 'PGRST205') throw new WorkspaceError('Additional follow-ups are unavailable: the database migration has not been applied. Saved tasks remain available below.', 503);
      throw databaseError(rows.error);
    }
    if (count.error) throw databaseError(count.error);
    return NextResponse.json({ items: rows.data ?? [], total: rows.count ?? 0, actionable: count.count ?? 0, page: filters.page, page_size: 25, generated_at: new Date().toISOString() });
  } catch (error) { return workspaceApiError(error, 'workday/get'); }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    let payload: { id?: unknown; expected_updated_at?: unknown; assignee?: unknown; due_date?: unknown };
    try { payload = await request.json() as typeof payload; }
    catch { throw new WorkspaceError('Invalid JSON body.', 400); }
    if (typeof payload.id !== 'string' || payload.id.length > 500) throw new WorkspaceError('A valid work item is required.', 400);
    const changes: Record<string, unknown> = {};
    if ('assignee' in payload) {
      if (payload.assignee !== null && (typeof payload.assignee !== 'string' || payload.assignee.length > 120)) throw new WorkspaceError('Assignee names must be at most 120 characters.', 400);
      changes.assignee = payload.assignee;
    }
    if ('due_date' in payload) {
      if (typeof payload.due_date !== 'string' || !Number.isFinite(Date.parse(payload.due_date)) || Date.parse(payload.due_date) <= Date.now()) throw new WorkspaceError('Choose a future snooze time.', 400);
      changes.due_date = payload.due_date;
    }
    const version = payload.expected_updated_at;
    if (version !== null && (typeof version !== 'string' || !Number.isFinite(Date.parse(version)))) throw new WorkspaceError('Refresh this work item before saving.', 400);
    const result = await db.rpc('update_workday_source', { p_id: payload.id, p_version: version, p_changes: changes });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data);
  } catch (error) { return workspaceApiError(error, 'workday/update'); }
}
