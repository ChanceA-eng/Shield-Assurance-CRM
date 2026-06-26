import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

type RangeKey = 'mtd' | 'ytd' | 'qtd' | '12m';

type ClaimsStatusRow = {
  status: string;
  value: number;
  color: string;
};

type LeadPipelineRow = {
  stage: string;
  value: number;
  color: string;
};

type PremiumTrendRow = {
  month: string;
  premium: number;
};

type CarrierMixRow = {
  carrier: string;
  count: number;
  premium: number;
};

interface ReportCard {
  id: string;
  title: string;
  href: string;
  summary: string;
  accent: string;
}

function dateAtUTC(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function getRange(key: RangeKey): { start: string; end: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (key === 'ytd') {
    return { start: dateAtUTC(year, 0, 1), end: dateAtUTC(year, month, now.getUTCDate()) };
  }

  if (key === 'qtd') {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return { start: dateAtUTC(year, quarterStartMonth, 1), end: dateAtUTC(year, month, now.getUTCDate()) };
  }

  if (key === '12m') {
    const start = new Date(Date.UTC(year, month - 11, 1));
    return { start: start.toISOString().slice(0, 10), end: dateAtUTC(year, month, now.getUTCDate()) };
  }

  return { start: dateAtUTC(year, month, 1), end: dateAtUTC(year, month, now.getUTCDate()) };
}

function monthKey(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function safeNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getColor(index: number): string {
  const colors = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f43f5e', '#a78bfa'];
  return colors[index % colors.length];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const range = (request.nextUrl.searchParams.get('range') ?? 'mtd') as RangeKey;
  const carrier = request.nextUrl.searchParams.get('carrier') ?? 'all';
  const { start, end } = getRange(range);
  const thisYearStart = dateAtUTC(new Date().getUTCFullYear(), 0, 1);
  const sixMonthsStart = dateAtUTC(new Date().getUTCFullYear(), Math.max(new Date().getUTCMonth() - 5, 0), 1);

  const policiesQuery = supabase
    .from('policies')
    .select('id,premium,effective_date,renewal_date,carrier,status,line_of_business,client_id,insured_name,created_at')
    .gte('effective_date', range === 'mtd' ? start : thisYearStart)
    .lte('effective_date', end)
    .order('effective_date', { ascending: true });

  const premiumTrendQuery = supabase
    .from('policies')
    .select('premium,effective_date')
    .gte('effective_date', sixMonthsStart)
    .lte('effective_date', end)
    .order('effective_date', { ascending: true });

  const carriersQuery = supabase
    .from('policies')
    .select('carrier,premium,status')
    .gte('effective_date', thisYearStart)
    .lte('effective_date', end);

  const [
    policiesMtd,
    clientsCount,
    policiesCount,
    claimsCount,
    endorsementsCount,
    claimsStatusRes,
    leadsStatusRes,
    premiumTrendRes,
    carrierMixRes,
    recentPoliciesRes,
    recentClaimsRes,
    recentEndorsementsRes,
    recentLeadsRes,
  ] = await Promise.all([
    policiesQuery,
    supabase.from('clients').select('id', { count: 'exact', head: true }),
    supabase.from('policies').select('id', { count: 'exact', head: true }).in('status', ['active', 'issued']),
    supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('endorsements').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('claims').select('status'),
    supabase.from('leads').select('status'),
    premiumTrendQuery,
    carriersQuery,
    supabase
      .from('policies')
      .select('id,insured_name,carrier,premium,effective_date,renewal_date,status,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('claims').select('id,type,status,date_of_loss,created_at,policies(insured_name,carrier)').order('created_at', { ascending: false }).limit(8),
    supabase.from('endorsements').select('id,type,status,effective_date,created_at,policies(insured_name,carrier)').order('created_at', { ascending: false }).limit(8),
    supabase.from('leads').select('id,full_name,status,line_of_business,source,created_at').order('created_at', { ascending: false }).limit(8),
  ]);

  if (policiesMtd.error) return NextResponse.json({ message: policiesMtd.error.message }, { status: 500 });
  if (clientsCount.error) return NextResponse.json({ message: clientsCount.error.message }, { status: 500 });
  if (policiesCount.error) return NextResponse.json({ message: policiesCount.error.message }, { status: 500 });
  if (claimsCount.error) return NextResponse.json({ message: claimsCount.error.message }, { status: 500 });
  if (endorsementsCount.error) return NextResponse.json({ message: endorsementsCount.error.message }, { status: 500 });
  if (claimsStatusRes.error) return NextResponse.json({ message: claimsStatusRes.error.message }, { status: 500 });
  if (leadsStatusRes.error) return NextResponse.json({ message: leadsStatusRes.error.message }, { status: 500 });
  if (premiumTrendRes.error) return NextResponse.json({ message: premiumTrendRes.error.message }, { status: 500 });
  if (carrierMixRes.error) return NextResponse.json({ message: carrierMixRes.error.message }, { status: 500 });
  if (recentPoliciesRes.error) return NextResponse.json({ message: recentPoliciesRes.error.message }, { status: 500 });
  if (recentClaimsRes.error) return NextResponse.json({ message: recentClaimsRes.error.message }, { status: 500 });
  if (recentEndorsementsRes.error) return NextResponse.json({ message: recentEndorsementsRes.error.message }, { status: 500 });
  if (recentLeadsRes.error) return NextResponse.json({ message: recentLeadsRes.error.message }, { status: 500 });

  const mtdPremium = (policiesMtd.data ?? []).reduce((sum, row) => sum + safeNumber(row.premium), 0);

  const premiumTrendMap = new Map<string, number>();
  for (const row of premiumTrendRes.data ?? []) {
    const key = monthKey(row.effective_date);
    premiumTrendMap.set(key, (premiumTrendMap.get(key) ?? 0) + safeNumber(row.premium));
  }

  const premiumTrend: PremiumTrendRow[] = Array.from(premiumTrendMap.entries()).map(([month, premium]) => ({ month, premium }));

  const carrierAggregate = new Map<string, { count: number; premium: number }>();
  for (const row of carrierMixRes.data ?? []) {
    const carrierName = row.carrier || 'Unknown';
    const current = carrierAggregate.get(carrierName) ?? { count: 0, premium: 0 };
    current.count += 1;
    current.premium += safeNumber(row.premium);
    carrierAggregate.set(carrierName, current);
  }

  const carrierMix: CarrierMixRow[] = Array.from(carrierAggregate.entries())
    .map(([carrierName, aggregate]) => ({ carrier: carrierName, count: aggregate.count, premium: aggregate.premium }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const claimsStatusMap = new Map<string, number>();
  for (const row of claimsStatusRes.data ?? []) {
    const key = row.status || 'unknown';
    claimsStatusMap.set(key, (claimsStatusMap.get(key) ?? 0) + 1);
  }

  const claimsStatus: ClaimsStatusRow[] = Array.from(claimsStatusMap.entries()).map(([statusName, value], index) => ({
    status: statusName,
    value,
    color: getColor(index),
  }));

  const leadStageMap = new Map<string, number>([
    ['new', 0],
    ['working', 0],
    ['quoted', 0],
    ['closed', 0],
  ]);
  for (const row of leadsStatusRes.data ?? []) {
    const stage = (row.status || 'new').toLowerCase();
    leadStageMap.set(stage, (leadStageMap.get(stage) ?? 0) + 1);
  }
  const leadPipeline: LeadPipelineRow[] = [
    { stage: 'New', value: leadStageMap.get('new') ?? 0, color: '#38bdf8' },
    { stage: 'Working', value: leadStageMap.get('working') ?? 0, color: '#818cf8' },
    { stage: 'Quoted', value: leadStageMap.get('quoted') ?? 0, color: '#34d399' },
    { stage: 'Closed', value: leadStageMap.get('closed') ?? 0, color: '#f59e0b' },
  ];

  const reportCards: ReportCard[] = [
    { id: 'production', title: 'Production Report', href: '/reports/production', summary: 'Written premium and production by period.', accent: 'sky' },
    { id: 'renewals', title: 'Renewals Report', href: '/reports/renewals', summary: 'Policies coming due by window and carrier.', accent: 'amber' },
    { id: 'claims', title: 'Claims Report', href: '/reports/claims', summary: 'Open claims by status and recent activity.', accent: 'rose' },
    { id: 'endorsements', title: 'Endorsements Report', href: '/reports/endorsements', summary: 'Open service changes and completion rate.', accent: 'violet' },
    { id: 'leads', title: 'Leads Pipeline Report', href: '/reports/leads', summary: 'Lead velocity by stage and source.', accent: 'emerald' },
    { id: 'carriers', title: 'Carrier Mix Report', href: '/reports/carriers', summary: 'Distribution of premium and count by carrier.', accent: 'indigo' },
  ];

  return NextResponse.json(
    {
      filters: { range, carrier, start, end },
      metrics: {
        mtd_written_premium: Math.round(mtdPremium),
        ytd_written_premium: Math.round(
          (premiumTrendRes.data ?? []).reduce((sum, row) => sum + safeNumber(row.premium), 0),
        ),
        active_clients: clientsCount.count ?? 0,
        active_policies: policiesCount.count ?? 0,
        open_claims: claimsCount.count ?? 0,
        open_endorsements: endorsementsCount.count ?? 0,
      },
      premiumTrend,
      carrierMix,
      claimsStatus,
      leadPipeline,
      reportCards,
      drilldowns: {
        policies: recentPoliciesRes.data ?? [],
        claims: recentClaimsRes.data ?? [],
        endorsements: recentEndorsementsRes.data ?? [],
        leads: recentLeadsRes.data ?? [],
      },
    },
    { status: 200 },
  );
}
