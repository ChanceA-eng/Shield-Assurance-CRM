import { NextRequest, NextResponse } from 'next/server';
import { apiActorName, getApiSession } from '../../../../lib/api-auth';
import { WorkspaceError } from '../../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';

interface DocumentLink {
  id: string;
  request_id: string;
  file_id: string;
  file_snapshot: Record<string, unknown>;
  added_by: string | null;
  added_at: string;
}

async function validateRequestAccount(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  requestId: string,
  accountId: string,
): Promise<void> {
  const { data, error } = await supabase.from('policy_change_requests')
    .select('id,policy_id').eq('id', requestId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new WorkspaceError('The service request was not found on this account.', 404);
  const policy = await supabase.from('policies').select('client_id')
    .eq('id', data.policy_id).eq('client_id', accountId).maybeSingle();
  if (policy.error) throw databaseError(policy.error);
  if (!policy.data) {
    throw new WorkspaceError('The service request was not found on this account.', 404);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const requestId = request.nextUrl.searchParams.get('request_id') ?? '';
    const accountId = request.nextUrl.searchParams.get('account_id') ?? '';
    if (!isUuid(requestId) || !isUuid(accountId)) throw new WorkspaceError('Choose a valid service request and account.', 400);
    await validateRequestAccount(supabase, requestId, accountId);
    const links = await supabase.from('policy_change_request_documents')
      .select('id,request_id,file_id,file_snapshot,added_by,added_at')
      .eq('request_id', requestId).order('added_at').order('id').returns<DocumentLink[]>();
    if (links.error) throw databaseError(links.error);
    const ids = (links.data ?? []).map((link) => link.file_id);
    const files = ids.length
      ? await supabase.from('client_files').select('id,file_name,file_type,file_size').eq('client_id', accountId).in('id', ids)
      : { data: [], error: null };
    if (files.error) throw databaseError(files.error);
    const fileById = new Map((files.data ?? []).map((file) => [file.id, file]));
    return NextResponse.json((links.data ?? []).flatMap((link) => {
      const file = fileById.get(link.file_id);
      if (!file) return [];
      return [{
        ...link,
        file_snapshot: {
          ...link.file_snapshot,
          file_name: file.file_name,
          file_type: file.file_type,
          file_size: file.file_size,
        },
        download_url: `/api/clients/${accountId}/files/${link.file_id}/download`,
      }];
    }));
  } catch (error) {
    return workspaceApiError(error, 'policy-change-request-documents/get');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const body = await workspaceBody(request);
    if (!isUuid(body.request_id) || !isUuid(body.account_id) || !isUuid(body.file_id)) {
      throw new WorkspaceError('Choose a valid request, account and uploaded document.', 400);
    }
    await validateRequestAccount(supabase, body.request_id, body.account_id);
    const file = await supabase.from('client_files')
      .select('id,client_id,file_name,file_type,file_size,status,metadata')
      .eq('id', body.file_id).eq('client_id', body.account_id).maybeSingle();
    if (file.error) throw databaseError(file.error);
    if (!file.data || file.data.status !== 'uploaded' || file.data.metadata?.source_kind !== 'stored'
      || typeof file.data.metadata?.storage?.path !== 'string' || !file.data.metadata.storage.path) {
      throw new WorkspaceError('Select a stored private document uploaded to this account.', 400);
    }
    const result = await supabase.from('policy_change_request_documents').insert({
      request_id: body.request_id,
      file_id: body.file_id,
      file_snapshot: {
        file_name: file.data.file_name,
        file_type: file.data.file_type,
        file_size: file.data.file_size,
        source_kind: 'stored',
      },
      added_by: session.user.id,
    }).select('id,request_id,file_id,file_snapshot,added_by,added_at').single();
    if (result.error) throw databaseError(result.error);
    return NextResponse.json({
      ...result.data,
      download_url: `/api/clients/${body.account_id}/files/${body.file_id}/download`,
    }, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'policy-change-request-documents/post');
  }
}
