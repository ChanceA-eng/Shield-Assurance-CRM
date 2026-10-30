import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { processDueEnrollments } from '../../../../lib/outreach-engine';

/** Manually runs the sequence engine: drafts due steps (and auto-sends when approval mode is off). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const result = await processDueEnrollments(supabase);
  return NextResponse.json(result, { status: 200 });
}
