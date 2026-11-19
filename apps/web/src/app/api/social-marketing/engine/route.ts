import { NextRequest, NextResponse } from 'next/server';
import { parseSocialEngineCommand } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceBody, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { socialDatabaseError } from '../../../../lib/social-marketing-errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const result = await db.rpc('list_social_engine', { p_actor: session.user.id });
    if (result.error) throw socialDatabaseError(result.error);
    if (!result.data) throw new WorkspaceError('Execution status was not confirmed. Reload.', 503);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-engine/list'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    let command;
    try { command = parseSocialEngineCommand(body); }
    catch (error) { throw new WorkspaceError(error instanceof Error ? error.message : 'Invalid scheduling command.', 400); }
    const result = command.action === 'prepare_publish'
      ? await db.rpc('prepare_social_publish_intent', {
        p_actor: session.user.id, p_id: command.id, p_post_id: command.post_id,
        p_revision: command.revision, p_connection_id: command.connection_id,
      })
      : command.action === 'resolve_publish'
        ? await db.rpc('resolve_social_publish_intent', {
          p_actor: session.user.id, p_id: command.id, p_expected_version: command.expected_version,
          p_resolution: command.resolution, p_remote_id: command.resolution === 'published' ? command.remote_id : null,
          p_permalink: command.resolution === 'published' ? command.permalink ?? null : null,
        })
      : await db.rpc('command_social_engine', { p_actor: session.user.id, p_command: command });
    if (result.error) throw socialDatabaseError(result.error);
    if (!result.data) throw new WorkspaceError('Execution command was not confirmed. Reload before retrying.', 503);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-engine/command'); }
}
