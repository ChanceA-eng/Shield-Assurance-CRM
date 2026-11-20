import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { discoveryAccess, discoveryFilters } from '../../../../lib/discovery';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    discoveryAccess(session.teamAccess);
    const result = await db.from('discovery_saved_searches').select('id,name,filters,updated_at')
      .eq('user_id', session.user.id).order('updated_at', { ascending: false }).limit(100);
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data ?? []);
  } catch (error) { return workspaceApiError(error, 'discovery/searches'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    discoveryAccess(session.teamAccess);
    const body = await workspaceBody(request);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) throw new WorkspaceError('Name this search using up to 80 characters.', 400);
    const filters = discoveryFilters(body.filters);
    const result = await db.from('discovery_saved_searches').insert({ user_id: session.user.id, name: body.name.trim(), filters })
      .select('id,name,filters,updated_at').single();
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { status: 201 });
  } catch (error) { return workspaceApiError(error, 'discovery/search-save'); }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    discoveryAccess(session.teamAccess);
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('Choose a valid saved search.', 400);
    const result = await db.from('discovery_saved_searches').delete().eq('id', body.id).eq('user_id', session.user.id).select('id');
    if (result.error) throw databaseError(result.error);
    if (!result.data?.length) throw new WorkspaceError('Saved search not found.', 404);
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'discovery/search-delete'); }
}
