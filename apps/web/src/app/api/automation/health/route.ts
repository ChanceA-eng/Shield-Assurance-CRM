import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const jobs = ['website-intake', 'follow-up-routine', 'outreach', 'renewal-radar', 'internal-actions'];
  const results = await Promise.all(jobs.map(async (job) => {
    const [latest, success] = await Promise.all([
      db.from('automation_runs').select('*').eq('job', job).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('automation_runs').select('finished_at').eq('job', job).eq('status', 'succeeded').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { job, latest: latest.data, last_success_at: success.data?.finished_at ?? null, error: latest.error ?? success.error };
  }));
  const failure = results.find((result) => result.error);
  if (failure) return NextResponse.json({ message: `Automation health could not load: ${failure.error?.message}` }, { status: 503 });
  return NextResponse.json({ jobs: results.map(({ error: _error, ...result }) => result) });
}
