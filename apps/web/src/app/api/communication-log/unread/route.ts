import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { loadUnreadMessageSummary } from '../../../../lib/unread-messages';

/** Unread inbound message counts: total, per account, and per lead. Powers the red message badges. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  try {
    return NextResponse.json(await loadUnreadMessageSummary(supabase), { status: 200 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to count messages.' }, { status: 500 });
  }
}
