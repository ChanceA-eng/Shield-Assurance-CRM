import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { ACTIVE_LEAD_STATUSES } from '../../../../lib/lead-pipeline';
import { loadHomePremiumMetrics } from '../../../../lib/home-metrics';
import { databaseError } from '../../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
    }

    const [
      policyPremiums,
      activeLeadsCount,
      totalLeadsCount,
      convertedLeadsCount,
      renewalsCount,
      openClaimsCount,
    ] = await Promise.all([
      loadHomePremiumMetrics(supabase),
      supabase.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null).in('status', [...ACTIVE_LEAD_STATUSES]),
      supabase.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null),
      supabase.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null).eq('status', 'won'),
      supabase
        .from('renewals')
        .select('id', { count: 'exact', head: true })
        .eq('renewal_bucket', '0-30'),
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    if (activeLeadsCount.error) throw databaseError(activeLeadsCount.error);
    if (totalLeadsCount.error) throw databaseError(totalLeadsCount.error);
    if (convertedLeadsCount.error) throw databaseError(convertedLeadsCount.error);
    if (renewalsCount.error) throw databaseError(renewalsCount.error);
    if (openClaimsCount.error) throw databaseError(openClaimsCount.error);

    const totalPremium = policyPremiums.total_written_premium;
    const totalLeads = totalLeadsCount.count ?? 0;
    const convertedLeads = convertedLeadsCount.count ?? 0;

    return NextResponse.json({
      ...policyPremiums,
      totalPremium,
      premium: totalPremium,
      active_leads: activeLeadsCount.count ?? 0,
      lead_conversion_rate: totalLeads > 0 ? convertedLeads / totalLeads : 0,
      renewals_30_days: renewalsCount.count ?? 0,
      open_claims: openClaimsCount.count ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Dashboard numbers could not be loaded. Refresh the page to try again.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
