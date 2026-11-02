import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { isUuid } from '../../../../../lib/workspace-validation';

const tables = { policy: 'policies', claim: 'claims', endorsement: 'endorsements', certificate: 'certificates' } as const;
export async function GET(request: NextRequest, context: { params: Promise<{ clientId: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const { clientId } = await context.params;
  const type = request.nextUrl.searchParams.get('type') ?? '';
  const id = request.nextUrl.searchParams.get('id');
  if (!isUuid(clientId) || !isUuid(id) || !Object.hasOwn(tables, type)) return NextResponse.json({ message: 'Choose a valid account record.' }, { status: 400 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const result = await db.from(tables[type as keyof typeof tables]).select('*').eq('id', id).eq('client_id', clientId).maybeSingle();
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  if (!result.data) return NextResponse.json({ message: 'This record was not found on this account.' }, { status: 404 });
  if (type !== 'policy') return NextResponse.json({ type, record: result.data });
  const [prior, schedule] = await Promise.all([
    typeof result.data.prior_policy_id === 'string'
      ? db.from('policies').select('id,policy_number,effective_date,expiration_date,status')
        .eq('id', result.data.prior_policy_id).eq('client_id', clientId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('policy_insured_assets').select('id,asset_id,snapshot,created_at').eq('policy_id', id).order('created_at').order('id'),
  ]);
  if (prior.error) return NextResponse.json({ message: prior.error.message }, { status: 500 });
  if (schedule.error) return NextResponse.json({ message: schedule.error.message }, { status: 500 });
  return NextResponse.json({ type, record: { ...result.data, related_prior_term: prior.data, insured_asset_schedule: schedule.data ?? [] } });
}
