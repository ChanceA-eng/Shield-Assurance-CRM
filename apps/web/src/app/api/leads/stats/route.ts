import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { ACTIVE_LEAD_STATUSES } from '../../../../lib/lead-pipeline';

/** Pipeline counts by outcome — powers the Won/Lost/Inactive badges. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const [active, won, lost, inactive] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).in('status', [...ACTIVE_LEAD_STATUSES]),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'lost'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'inactive'),
  ]);

  return NextResponse.json(
    {
      active: active.count ?? 0,
      won: won.count ?? 0,
      lost: lost.count ?? 0,
      inactive: inactive.count ?? 0,
    },
    { status: 200 },
  );
}
