import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { processDueProspectingEmailDrafts } from '../../../../lib/prospecting-cadence';

/** Manually runs the sequence engine: drafts due steps (and auto-sends when approval mode is off). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const [result, prospecting] = await Promise.all([
    processDueEnrollments(supabase),
    processDueProspectingEmailDrafts(supabase),
  ]);
  return NextResponse.json({ ...result, prospectingDrafted: prospecting.drafted, prospectingSkipped: prospecting.skipped }, { status: 200 });
}
