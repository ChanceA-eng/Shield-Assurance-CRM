import { NextRequest, NextResponse } from 'next/server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { isUuid } from '../../../lib/workspace-validation';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';

async function handle(request: NextRequest, write: boolean): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const accountId = request.nextUrl.searchParams.get('account_id');
    const type = request.nextUrl.searchParams.get('type');
    const id = request.nextUrl.searchParams.get('id');
    if (!isUuid(accountId) || !isUuid(id) || (type !== 'policy' && type !== 'quote')) {
      throw new WorkspaceError('Choose a valid account policy or quote.', 400);
    }
    const record = await db.from(type === 'policy' ? 'policies' : 'quote_options').select('id')
      .eq('client_id', accountId).eq('id', id).maybeSingle();
    if (record.error) throw databaseError(record.error);
    if (!record.data) throw new WorkspaceError('Placement record was not found on this account.', 404);
    if (write) {
      const body = await workspaceBody(request);
      if (!isUuid(body.file_id)) throw new WorkspaceError('Choose an uploaded account document.', 400);
      const result = await db.rpc('attach_placement_document', {
        p_account_id: accountId, p_policy_id: type === 'policy' ? id : null,
        p_quote_id: type === 'quote' ? id : null, p_file_id: body.file_id, p_actor: apiActorName(session.user),
      });
      if (result.error) throw databaseError(result.error);
      return NextResponse.json(result.data, { status: 201 });
    }
    const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Invalid document page.', 400);
    const result = await db.from('placement_documents').select('*').eq(type === 'policy' ? 'policy_id' : 'quote_id', id)
      .order('added_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data ?? []);
  } catch (error) { return workspaceApiError(error, 'placement-documents'); }
}
export const GET = (request: NextRequest): Promise<NextResponse> => handle(request, false);
export const POST = (request: NextRequest): Promise<NextResponse> => handle(request, true);
