import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { loadUnreadMessageSummary } from '../../../../lib/unread-messages';

/** Unread inbound message counts per lead. Powers the "N new" badges on pipeline cards. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  try {
    const summary = await loadUnreadMessageSummary(supabase);
    return NextResponse.json(summary.byLead, { status: 200 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to count messages.' }, { status: 500 });
  }
}