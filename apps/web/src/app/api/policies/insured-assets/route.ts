import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { isUuid } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const accountId = request.nextUrl.searchParams.get('account_id');
  if (!isUuid(accountId)) return NextResponse.json({ message: 'Select a valid account.' }, { status: 400 });
  const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
  if (!Number.isSafeInteger(page) || page < 0) return NextResponse.json({ message: 'Invalid insured asset page.' }, { status: 400 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const account = await db.from('clients').select('id').eq('id', accountId).maybeSingle();
  if (account.error) return NextResponse.json({ message: account.error.message }, { status: 500 });
  if (!account.data) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
  const result = await db.from('client_assets')
    .select('id,title,asset_type,value,metadata,created_at')
    .eq('client_id', accountId).is('archived_at', null).neq('asset_type', 'note')
    .order('created_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  return NextResponse.json(result.data ?? []);
}
