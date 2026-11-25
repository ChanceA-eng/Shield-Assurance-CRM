import { NextRequest, NextResponse } from 'next/server';
import { validateSocialDraftCommand } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { socialDatabaseError } from '../../../../lib/social-marketing-errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status') ?? 'draft';
    const offset = Number(params.get('offset') ?? '0');
    const id = params.get('id');
    if (!['draft', 'archived', 'awaiting_review', 'approved', 'changes_requested'].includes(status) || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647
      || (id !== null && !isUuid(id))) throw new WorkspaceError('Choose a valid draft filter.', 400);
    const { data, error } = await db.rpc('list_social_drafts', {
      p_actor: session.user.id, p_status: status, p_offset: offset, p_id: id,
    });
    if (error) throw socialDatabaseError(error);
    if (!data) throw new WorkspaceError('The database returned no draft data. Reload and try again.', 500);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-marketing/list'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const parsed = validateSocialDraftCommand(await workspaceBody(request));
    if (parsed.error !== null) throw new WorkspaceError(parsed.error, 400);
    const command = parsed.command;
    if (session.teamAccess?.mode === 'restricted'
      && session.teamAccess.grants[command.action === 'archive' ? 'social.delete' : 'social.edit'] !== 'agency') {
      throw new WorkspaceError('You do not have access to perform this draft action.', 403);
    }
    const { data, error } = await db.rpc('save_social_draft', {
      p_actor: session.user.id, p_id: command.id, p_action: command.action,
      p_title: command.action === 'archive' ? null : command.title,
      p_caption: command.action === 'archive' ? null : command.caption,
      p_link_url: command.action === 'archive' ? null : command.link_url ?? null,
      p_expected_revision: command.action === 'create' ? null : command.expected_revision,
      ...(command.action !== 'archive' && command.media_ids !== undefined ? { p_media_ids: command.media_ids } : {}),
    });
    if (error) throw socialDatabaseError(error);
    if (!data) throw new WorkspaceError('The database did not confirm the saved draft. Reload before retrying.', 500);
    return NextResponse.json(data, { status: command.action === 'create' ? 201 : 200 });
  } catch (error) { return workspaceApiError(error, 'social-marketing/save'); }
}
