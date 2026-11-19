import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { processDueProspectingEmailDrafts } from '../../../../lib/prospecting-cadence';

/**
 * Scheduled runner for the outreach engine (e.g. Vercel cron, hourly during
 * business hours). Secured with CRON_SECRET like the other cron routes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const [result, prospecting] = await Promise.all([
    processDueEnrollments(supabase),
    processDueProspectingEmailDrafts(supabase),
  ]);
  return NextResponse.json({ ...result, prospectingDrafted: prospecting.drafted, prospectingSkipped: prospecting.skipped }, { status: 200 });
}
