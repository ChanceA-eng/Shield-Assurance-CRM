import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

type RenewalWindow = '30' | '60' | '90' | 'overdue';

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysFromNowISO(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

async function getWindowCount(window: RenewalWindow): Promise<number> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return 0;

  const today = isoDate(new Date());
  let query = supabase.from('policies').select('id', { count: 'exact', head: true }).in('status', ['active', 'issued']);
  if (window === 'overdue') {
    query = query.lt('renewal_date', today);
  } else {
    const withinDays = Number(window);
    query = query.gte('renewal_date', today).lte('renewal_date', daysFromNowISO(withinDays));
  }

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const rawWindow = request.nextUrl.searchParams.get('window') ?? '30';
  const window: RenewalWindow = rawWindow === '60' || rawWindow === '90' || rawWindow === 'overdue' ? rawWindow : '30';
  const today = isoDate(new Date());

  let query = supabase
    .from('policies')
    .select('id,client_id,insured_name,carrier,line_of_business,premium,renewal_date,status')
    .in('status', ['active', 'issued'])
    .order('renewal_date', { ascending: true })
    .limit(250);

  if (window === 'overdue') {
    query = query.lt('renewal_date', today);
  } else {
    const withinDays = Number(window);
    query = query.gte('renewal_date', today).lte('renewal_date', daysFromNowISO(withinDays));
  }

  const [{ data, error }, count30, count60, count90, countOverdue] = await Promise.all([
    query,
    getWindowCount('30'),
    getWindowCount('60'),
    getWindowCount('90'),
    getWindowCount('overdue'),
  ]);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      window,
      counts: {
        '30': count30,
        '60': count60,
        '90': count90,
        overdue: countOverdue,
      },
      items: data ?? [],
    },
    { status: 200 },
  );
}
