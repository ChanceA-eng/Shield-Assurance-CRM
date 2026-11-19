import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError } from '../../../../lib/workspace-api';
import { runOpportunityJobs } from '../../../../lib/opportunity-jobs';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ message: 'Unauthorized OIP job request.' }, { status: 401 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const result = await runOpportunityJobs(db);
    return NextResponse.json(result, { status: result.failed ? 207 : 200 });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/jobs'); }
}
