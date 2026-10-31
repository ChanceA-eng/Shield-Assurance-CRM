import { NextRequest, NextResponse } from 'next/server';
import { isRecordType } from '@crm/shared';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { isUuid } from '../../../lib/workspace-validation';
import { recordFilter, resolveRecordScope, WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const params = request.nextUrl.searchParams;
    const type = params.get('record_type');
    const id = params.get('record_id');
    const itemId = params.get('item_id');
    const table = params.get('table');
    const page = Number(params.get('page') ?? '0');
    if (!isRecordType(type) || !isUuid(id) || !isUuid(itemId) || (table !== 'interactions' && table !== 'client_assets')) {
      throw new WorkspaceError('Choose a valid profile and history record.', 400);
    }
    if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Invalid history page.', 400);
    const scope = await resolveRecordScope(supabase, { type, id });
    const { data, error } = await supabase.from('client_activities').select('id,title,occurred_at,metadata').or(recordFilter(scope))
      .eq('metadata->>record_id', itemId).eq('metadata->>record_table', table)
      .order('occurred_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
    if (error) throw databaseError(error);
    return NextResponse.json(data ?? []);
  } catch (error) {
    return workspaceApiError(error, 'record-activity/get');
  }
}
