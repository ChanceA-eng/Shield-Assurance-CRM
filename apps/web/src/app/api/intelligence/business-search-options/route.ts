import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { researchPlaces } from '../../../../lib/research-geography';
import { workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await activeAgencyMember(db, session.user.id);
    const state = request.nextUrl.searchParams.get('state') ?? '';
    return NextResponse.json({ state, version: '2026', places: researchPlaces(state) }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (error) { return workspaceApiError(error, 'intelligence/business-search-options'); }
}
