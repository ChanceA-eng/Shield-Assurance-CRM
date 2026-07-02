import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

function thirtyDaysFromNowISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
    }

    const [
      policyPremiums,
      activeLeadsCount,
      totalLeadsCount,
      convertedLeadsCount,
      renewalsCount,
      openClaimsCount,
    ] = await Promise.all([
      supabase.from('policies').select('premium'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).in('status', ['new', 'working', 'quoted']),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
      supabase
        .from('policies')
        .select('id', { count: 'exact', head: true })
        .lte('renewal_date', thirtyDaysFromNowISO())
        .eq('status', 'active'),
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    if (policyPremiums.error) throw policyPremiums.error;
    if (activeLeadsCount.error) throw activeLeadsCount.error;
    if (totalLeadsCount.error) throw totalLeadsCount.error;
    if (convertedLeadsCount.error) throw convertedLeadsCount.error;
    if (renewalsCount.error) throw renewalsCount.error;
    if (openClaimsCount.error) throw openClaimsCount.error;

    const totalPremium = (policyPremiums.data ?? []).reduce((sum, row) => sum + toNumber(row.premium), 0);
    const totalLeads = totalLeadsCount.count ?? 0;
    const convertedLeads = convertedLeadsCount.count ?? 0;

    return NextResponse.json({
      total_written_premium: Math.round(totalPremium),
      totalPremium: Math.round(totalPremium),
      premium: Math.round(totalPremium),
      active_leads: activeLeadsCount.count ?? 0,
      lead_conversion_rate: totalLeads > 0 ? convertedLeads / totalLeads : 0,
      renewals_30_days: renewalsCount.count ?? 0,
      open_claims: openClaimsCount.count ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load home metrics from Supabase.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
