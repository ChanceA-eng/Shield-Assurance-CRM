import { NextRequest, NextResponse } from 'next/server';
import { createDashboardAutomationAlerts, runRenewalAutomation } from '../../../../lib/automation';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'renewals';

  if (mode === 'alerts') {
    await createDashboardAutomationAlerts();
    return NextResponse.json({ ok: true, mode: 'alerts' }, { status: 200 });
  }

  const result = await runRenewalAutomation();
  return NextResponse.json({ ok: true, mode: 'renewals', ...result }, { status: 200 });
}
