import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { processDueEnrollments } from '../../../../lib/outreach-engine';

/**
 * Scheduled runner for the outreach engine (e.g. Vercel cron, hourly during
 * business hours). Secured with CRON_SECRET like the other cron routes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const result = await processDueEnrollments(supabase);
  return NextResponse.json(result, { status: 200 });
}
