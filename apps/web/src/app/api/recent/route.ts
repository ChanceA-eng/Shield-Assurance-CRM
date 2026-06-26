import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

interface RecentRecord {
  id: string;
  type: string;
  name: string;
  touchedAt: string;
}

export async function GET(): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const [clientsRes, policiesRes] = await Promise.all([
    supabase.from('clients').select('id,full_name,created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('policies').select('id,line_of_business,created_at').order('created_at', { ascending: false }).limit(5),
  ]);

  if (clientsRes.error) {
    return NextResponse.json({ message: clientsRes.error.message }, { status: 500 });
  }

  if (policiesRes.error) {
    return NextResponse.json({ message: policiesRes.error.message }, { status: 500 });
  }

  const clientRows: RecentRecord[] = (clientsRes.data ?? []).map((row) => ({
    id: row.id,
    type: 'Client',
    name: row.full_name,
    touchedAt: row.created_at,
  }));

  const policyRows: RecentRecord[] = (policiesRes.data ?? []).map((row) => ({
    id: row.id,
    type: 'Policy',
    name: `Policy ${row.id.slice(0, 8)} (${row.line_of_business})`,
    touchedAt: row.created_at,
  }));

  const merged = [...clientRows, ...policyRows]
    .sort((a, b) => new Date(b.touchedAt).getTime() - new Date(a.touchedAt).getTime())
    .slice(0, 10);

  return NextResponse.json(merged, { status: 200 });
}
