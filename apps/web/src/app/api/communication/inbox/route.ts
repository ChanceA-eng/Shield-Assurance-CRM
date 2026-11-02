import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { conversationHref, parseConversationKey } from '../../../../lib/conversations';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return NextResponse.json({ message: 'Choose a valid inbox page.' }, { status: 400 });
  const search = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (search.length > 200) return NextResponse.json({ message: 'Search must be at most 200 characters.' }, { status: 400 });
  let query = db.from('conversation_inbox').select('*', { count: 'exact' });
  if (search) {
    const escaped = search.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&').replace(/[(),]/g, ' ');
    query = query.or(['name', 'email', 'phone', 'last_subject'].map((field) => `${field}.ilike.%${escaped}%`).join(','));
  }
  const result = await query.order('last_at', { ascending: false }).order('key').range(page * 25, page * 25 + 24);
  if (result.error) return NextResponse.json({ message: `Inbox could not be loaded: ${result.error.message}` }, { status: 500 });
  const conversations = (result.data ?? []).map((row) => {
    const ref = parseConversationKey(row.key);
    return { ...row, href: ref ? conversationHref(ref) : '/communication', can_email: Boolean(row.email) };
  });
  return NextResponse.json({ conversations, total: result.count ?? 0, page, page_size: 25 });
}
