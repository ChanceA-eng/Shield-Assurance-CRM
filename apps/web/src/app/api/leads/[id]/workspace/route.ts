import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';
import { isUuid } from '../../../../../lib/workspace-validation';
import { resolveRecordScope, WorkspaceError } from '../../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const { id } = await context.params;
    const scope = await resolveRecordScope(supabase, { type: 'lead', id });
    if (!scope.clientId) return NextResponse.json({ leadId: id, clientId: null, clientName: null });
    const { data, error } = await supabase.from('clients').select('full_name').eq('id', scope.clientId).single();
    if (error) throw databaseError(error);
    return NextResponse.json({ leadId: id, clientId: scope.clientId, clientName: data.full_name });
  } catch (error) {
    return workspaceApiError(error, 'lead-workspace/get');
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new WorkspaceError('A valid lead id is required.', 400);
    const body = await workspaceBody(request);
    if (body.client_id !== undefined && !isUuid(body.client_id)) throw new WorkspaceError('Choose a valid existing account.', 400);
    if ((body.create === true) === isUuid(body.client_id)) throw new WorkspaceError('Choose an existing account or create a new one, not both.', 400);
    const { data, error } = await supabase.rpc('link_lead_account', {
      p_lead_id: id, p_client_id: body.client_id ?? null, p_create: body.create === true,
    });
    if (error) throw databaseError(error);
    return NextResponse.json({ leadId: id, clientId: data });
  } catch (error) {
    return workspaceApiError(error, 'lead-workspace/post');
  }
}
