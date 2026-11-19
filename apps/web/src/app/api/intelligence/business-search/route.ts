import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { searchBusinesses } from '../../../../lib/business-research-server';
import { after } from 'next/server';
import { runBusinessResearchJobs } from '../../../../lib/business-research-jobs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const body = await workspaceBody(request);
    if (!isUuid(body.request_id)) throw new WorkspaceError('Provide a search request reference.', 400);
    if (body.page !== undefined && typeof body.page !== 'number') throw new WorkspaceError('Choose a numeric search page.', 400);
    const token = body.google_page_token ?? '';
    if (typeof token !== 'string' || token.length > 2000) throw new WorkspaceError('Google Maps page is invalid.', 400);
    const data = await searchBusinesses(db, session.user.id, body.filters, typeof body.page === 'number' ? body.page : 0, body.request_id,
      { google_page_token: token, skip_records: body.skip_records === true, skip_google: body.skip_google === true });
    after(async () => { await runBusinessResearchJobs(db); });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return workspaceApiError(error, 'intelligence/business-search'); }
}
