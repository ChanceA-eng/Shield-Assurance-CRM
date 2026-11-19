import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { discoveryAccess, discoveryFilters } from '../../../../lib/discovery';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await discoveryAccess(db, session.user.id);
    const params = request.nextUrl.searchParams;
    const filters = discoveryFilters({
      ...Object.fromEntries(params), employees_min: params.get('employees_min') ? Number(params.get('employees_min')) : null,
      employees_max: params.get('employees_max') ? Number(params.get('employees_max')) : null,
    });
    const page = Number(params.get('page') ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 100000) throw new WorkspaceError('Choose a valid results page.', 400);
    const result = await db.rpc('search_discovery_candidates', { p_actor: session.user.id, p_filters: filters, p_page: page });
    if (result.error) throw databaseError(result.error);
    if (!isRecord(result.data) || !Array.isArray(result.data.candidates) || typeof result.data.total !== 'number') throw new WorkspaceError('Discovery results could not be verified.', 503);
    return NextResponse.json(result.data);
  } catch (error) { return workspaceApiError(error, 'discovery/candidates'); }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await discoveryAccess(db, session.user.id);
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || typeof body.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_updated_at))) throw new WorkspaceError('Refresh this candidate before reviewing.', 400);
    const result = await db.rpc('review_discovery_candidate', { p_actor: session.user.id, p_candidate: body.id,
      p_expected: body.expected_updated_at, p_review: body.review, p_note: body.note });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data);
  } catch (error) { return workspaceApiError(error, 'discovery/review'); }
}
