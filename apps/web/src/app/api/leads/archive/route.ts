import { NextRequest, NextResponse } from 'next/server';
import { getApiSession, apiActorName } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { isUuid } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { describeLeadArchive, parseLeadArchiveResults } from '../../../../lib/lead-archive';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    if (body.action !== 'archive' && body.action !== 'restore' && body.action !== 'delete') throw new WorkspaceError('Choose Archive, Restore or Delete.', 400);
    if (!Array.isArray(body.ids) || body.ids.length < 1) throw new WorkspaceError('Select at least one lead.', 400);
    if (body.ids.length > 200) throw new WorkspaceError('Select up to 200 leads at a time.', 400);
    const rawIds: unknown[] = body.ids;
    if (!rawIds.every(isUuid)) throw new WorkspaceError('One of the selected leads could not be found. Refresh the page and try again.', 400);
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) throw new WorkspaceError('Keep the archive reason under 500 characters.', 400);
    const ids = [...new Set((rawIds as string[]).map((id) => id.toLowerCase()))];
    const actor = apiActorName(session.user);
    const saved = body.action === 'archive'
      ? await db.rpc('archive_leads', { p_ids: ids, p_actor: actor, p_reason: typeof body.reason === 'string' ? body.reason : null })
      : body.action === 'restore'
        ? await db.rpc('restore_leads', { p_ids: ids, p_actor: actor })
        : await db.rpc('purge_leads', { p_ids: ids, p_actor: actor });
    if (saved.error) throw databaseError(saved.error);
    const results = parseLeadArchiveResults(saved.data);
    if (!results || results.length !== ids.length) throw new WorkspaceError('We could not confirm the change. Refresh the page to check the leads.', 503);
    return NextResponse.json({ results, message: describeLeadArchive(body.action, results) });
  } catch (error) {
    return workspaceApiError(error, 'leads/archive');
  }
}
