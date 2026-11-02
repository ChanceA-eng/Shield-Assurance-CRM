import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { operationErrorStatus } from '../../../../lib/policy-identity';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const payload = await request.json().catch(() => null) as {
    survivor_id?: unknown; merge_ids?: unknown; fields?: unknown;
  } | null;
  if (!payload || typeof payload.survivor_id !== 'string' || !Array.isArray(payload.merge_ids)
    || !payload.merge_ids.length || payload.merge_ids.some((id: unknown) => typeof id !== 'string')
    || (payload.fields !== undefined && (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)))) {
    return NextResponse.json({ message: 'survivor_id, merge_ids and valid reviewed fields are required.' }, { status: 400 });
  }
  const { data, error } = await supabase.rpc('merge_leads_atomic', {
    p_survivor_id: payload.survivor_id, p_merge_ids: [...new Set(payload.merge_ids)],
    p_fields: payload.fields ?? {},
  });
  if (error) return NextResponse.json({ message: error.message }, { status: operationErrorStatus(error.code) });
  return NextResponse.json(data);
}
