import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { policyIdentity } from '../../../../lib/policy-identity';
import { ACTIVE_LEAD_STATUSES } from '../../../../lib/lead-pipeline';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  let accountId: string;
  try {
    ({ accountId } = policyIdentity({ account_id: request.nextUrl.searchParams.get('account_id') }));
  } catch {
    return NextResponse.json({ message: 'Select an account before choosing a lead.' }, { status: 400 });
  }
  let query = supabase.from('leads').select('id,full_name,email,phone,account_id')
    .in('status', [...ACTIVE_LEAD_STATUSES]).or(`account_id.is.null,account_id.eq.${accountId}`);
  const search = request.nextUrl.searchParams.get('q')?.trim();
  if (search) query = query.ilike('full_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, error } = await query.order('full_name').limit(50);
  return error ? NextResponse.json({ message: error.message }, { status: 500 }) : NextResponse.json(data ?? []);
}
