import { NextRequest, NextResponse } from 'next/server';
import { createDashboardAutomationAlerts } from '../../../../lib/automation';
import { runRenewalRadar } from '../../../../lib/renewal-automation';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'renewals';

  if (mode === 'alerts') {
    await createDashboardAutomationAlerts();
    return NextResponse.json({ ok: true, mode: 'alerts' }, { status: 200 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  try {
    const result = await runRenewalRadar(supabase);
    return NextResponse.json({ ok: true, mode: 'renewals', ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Renewal automation failed.' }, { status: 500 });
  }
}