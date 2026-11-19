import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { isUuid } from '../../../../lib/workspace-validation';

import { friendlyErrorMessage } from '../../../../lib/workspace-api';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const accountId = request.nextUrl.searchParams.get('account_id'), id = request.nextUrl.searchParams.get('id');
  const before = request.nextUrl.searchParams.get('before_id');
  if (!isUuid(accountId) || !isUuid(id) || (before !== null
    && (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > BigInt('9223372036854775807')))) {
    return NextResponse.json({ message: 'Choose a valid policy history and cursor.' }, { status: 400 });
  }
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  const policy = await db.from('policies').select('id').eq('id', id).eq('client_id', accountId).maybeSingle();
  if (policy.error) return NextResponse.json({ message: friendlyErrorMessage(policy.error) }, { status: 500 });
  if (!policy.data) return NextResponse.json({ message: 'Policy was not found on this account.' }, { status: 404 });
  let query = db.from('policy_term_history').select('id::text,event,snapshot,recorded_by,recorded_at').eq('policy_id', id)
    .order('id', { ascending: false }).limit(100);
  if (before) query = query.lt('id', before);
  const result = await query;
  return result.error ? NextResponse.json({ message: friendlyErrorMessage(result.error) }, { status: 500 }) : NextResponse.json(result.data ?? []);
}
