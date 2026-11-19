import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { loadTaskTimeliness } from '../../../../lib/task-timeliness';
import { workspaceApiError } from '../../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (auth) return auth;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Task metrics are unavailable. Refresh to retry.' }, { status: 503 });
  try { return NextResponse.json(await loadTaskTimeliness(db), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return workspaceApiError(error, 'metrics/tasks'); }
}
