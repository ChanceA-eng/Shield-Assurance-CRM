import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isNoteKind, isRecordType, type RecordTarget } from '@crm/shared';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { absoluteDateTime, isRecord, isUuid } from '../../../lib/workspace-validation';
import { namedTaskSubject, recordFilter, resolveRecordScope, WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';

const columns = 'id,lead_id,client_id,content,note_type,pinned,author_name,updated_by,created_at,updated_at,follow_up_at,follow_up_completed';

function targetFromQuery(request: NextRequest): RecordTarget {
  const legacyId = request.nextUrl.searchParams.get('leadId');
  const type = legacyId ? 'lead' : request.nextUrl.searchParams.get('record_type');
  const id = legacyId || request.nextUrl.searchParams.get('record_id');
  if (!isRecordType(type) || !isUuid(id)) throw new WorkspaceError('A valid lead or client is required.', 400);
  return { type, id };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    if (request.nextUrl.searchParams.get('dueCount') === 'true') {
      const { count, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('kind', 'reminder').eq('related_type', 'lead').eq('status', 'open').lte('due_date', new Date().toISOString());
      if (error) throw databaseError(error);
      return NextResponse.json({ count: count ?? 0 });
    }
    if (request.nextUrl.searchParams.get('dueList') === 'true') {
      const { data, error } = await supabase.from('tasks').select('id,related_id,description,due_date')
        .eq('kind', 'reminder').eq('related_type', 'lead').eq('status', 'open').lte('due_date', new Date().toISOString()).order('due_date').limit(300);
      if (error) throw databaseError(error);
      return NextResponse.json((data ?? []).map((task) => ({
        id: task.id, lead_id: task.related_id, content: task.description, follow_up_at: task.due_date, follow_up_completed: false,
      })));
    }
    const scope = await resolveRecordScope(supabase, targetFromQuery(request));
    const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
    if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Invalid note page.', 400);
    const { data, error } = await supabase.from('interactions').select(columns).or(recordFilter(scope)).is('archived_at', null)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
    if (error) throw databaseError(error);
    return NextResponse.json(data ?? []);
  } catch (error) {
    return workspaceApiError(error, 'interactions/get');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    const type = body.lead_id ? 'lead' : 'client';
    const id = body.lead_id || body.client_id;
    if (!isUuid(id) || (body.lead_id && body.client_id)) throw new WorkspaceError('Choose exactly one valid lead or client.', 400);
    const scope = await resolveRecordScope(supabase, { type, id });
    if (typeof body.content !== 'string' || !body.content.trim()) throw new WorkspaceError('Enter a note before saving.', 400);
    if (body.content.length > 20000) throw new WorkspaceError('Notes must be 20,000 characters or fewer.', 400);
    const noteType = body.note_type ?? 'general';
    if (!isNoteKind(noteType)) throw new WorkspaceError('Choose a valid note type.', 400);
    if (body.id !== undefined && !isUuid(body.id)) throw new WorkspaceError('Invalid note save id.', 400);
    const noteId = typeof body.id === 'string' ? body.id : randomUUID();
    let reminder: { subject: string; due_date: string; priority: string } | null = null;
    const reminderBody = body.reminder ?? (body.follow_up_at ? { subject: 'Follow up', due_date: body.follow_up_at } : null);
    if (reminderBody !== null) {
      if (!isRecord(reminderBody) || typeof reminderBody.subject !== 'string' || !reminderBody.subject.trim()) {
        throw new WorkspaceError('Describe what this reminder is for.', 400);
      }
      if (reminderBody.subject.trim().length > 240) throw new WorkspaceError('Reminder actions must be 240 characters or fewer.', 400);
      const due = absoluteDateTime(reminderBody.due_date);
      if (!due) throw new WorkspaceError('Choose a valid reminder date and time with a timezone.', 400);
      const priority = reminderBody.priority ?? 'medium';
      if (priority !== 'low' && priority !== 'medium' && priority !== 'high') throw new WorkspaceError('Invalid reminder priority.', 400);
      reminder = { subject: namedTaskSubject(scope.name, reminderBody.subject), due_date: due, priority };
    }
    const { data, error } = await supabase.rpc('save_note_with_reminder', {
      p_id: noteId, p_lead_id: scope.leadId, p_client_id: scope.leadId ? null : scope.clientId,
      p_content: body.content.trim(), p_note_type: noteType,
      p_author_id: session.user.id, p_author_name: apiActorName(session.user), p_reminder: reminder,
    });
    if (error) throw databaseError(error);
    const saved: unknown = data;
    if (!isRecord(saved) || !isRecord(saved.note) || !isUuid(saved.note.id)
      || (saved.reminder !== null && (!isRecord(saved.reminder) || !isUuid(saved.reminder.id)))) {
      throw new WorkspaceError('The note save did not return a saved record.', 500);
    }
    return NextResponse.json({ ...saved.note, reminder: saved.reminder }, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'interactions/post');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('A valid note id is required.', 400);
    if (!absoluteDateTime(body.expected_updated_at)) throw new WorkspaceError('The last-loaded note timestamp is required.', 400);
    const updates: Record<string, unknown> = { updated_by: apiActorName(session.user) };
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20000) throw new WorkspaceError('Enter a non-empty note of at most 20,000 characters.', 400);
      updates.content = body.content.trim();
    }
    if (body.note_type !== undefined) {
      if (!isNoteKind(body.note_type)) throw new WorkspaceError('Invalid note type.', 400);
      updates.note_type = body.note_type;
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') throw new WorkspaceError('Pinned must be true or false.', 400);
      updates.pinned = body.pinned;
    }
    if (Object.keys(updates).length === 1) throw new WorkspaceError('No note changes were provided.', 400);
    let query = supabase.from('interactions').update(updates).eq('id', body.id);
    if (body.lead_id !== undefined || body.client_id !== undefined) {
      const recordId = body.lead_id || body.client_id;
      if ((body.lead_id && body.client_id) || !isUuid(recordId)) throw new WorkspaceError('Choose one valid note profile.', 400);
      const scope = await resolveRecordScope(supabase, { type: body.lead_id ? 'lead' : 'client', id: recordId });
      query = query.or(recordFilter(scope));
    }
    if (typeof body.expected_updated_at === 'string') query = query.eq('updated_at', body.expected_updated_at);
    const { data, error } = await query.select(columns).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This note changed or no longer exists. Refresh before editing.', 409);
    return NextResponse.json(data);
  } catch (error) {
    return workspaceApiError(error, 'interactions/patch');
  }
}
