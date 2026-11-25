import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getApiSession } from '../../../../lib/api-auth';
import { conversationHref, parseConversationKey } from '../../../../lib/conversations';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { hasUnrestrictedConversationAccess } from '../../../../lib/staff-workspace';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return NextResponse.json({ message: 'Choose a valid inbox page.' }, { status: 400 });
  const search = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (search.length > 200) return NextResponse.json({ message: 'Search must be at most 200 characters.' }, { status: 400 });
  if (session.teamAccess?.mode === 'restricted' && !hasUnrestrictedConversationAccess(session.teamAccess)) {
    try {
      const { data, error } = await db.rpc('team_conversation_inbox', { p_actor: session.user.id, p_search: search, p_page: page });
      if (error) throw databaseError(error);
      if (!data || !Array.isArray(data.conversations) || typeof data.total !== 'number') throw new WorkspaceError('The inbox could not be loaded.', 500);
      const conversations = data.conversations.map((row: { key: string; email: string | null }) => {
        const ref = parseConversationKey(row.key);
        return { ...row, href: ref ? `/communication?conversation=${encodeURIComponent(row.key)}` : '/communication', can_email: Boolean(row.email) };
      });
      return NextResponse.json({ ...data, conversations }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return workspaceApiError(error, 'communication/inbox'); }
  }
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
