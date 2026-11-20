import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../../../lib/api-auth';
import { operationErrorStatus } from '../../../../../lib/policy-identity';
import { isRecord } from '../../../../../lib/workspace-validation';
import { validateReviewedIntakeFields } from '../../../../../lib/policy-document-intake';
import { accountDocumentReadScope, accountRecordScope } from '../../../../../lib/team-request-access';
import { checkAccountUploadAccess } from '../../../../../lib/account-upload-access';
import {
  CLIENT_FILE_COLUMNS,
  classifyClientFile,
  isUuid,
  removeStoredObject,
  storedLocation,
  toClientFileView,
  validateExternalUrl,
  type ClientFileRecord,
} from '../../../../../lib/account-documents';

import { friendlyErrorMessage } from '../../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ clientId: string }>;
}

const DOCUMENT_TYPES = new Set(['PDF', 'IMAGE', 'WORD', 'SPREADSHEET', 'TEXT', 'OTHER']);

interface LinkPayload {
  id?: string;
  kind?: string;
  file_name?: string;
  file_url?: string;
  file_type?: string;
  notes?: string;
  intake_review?: unknown;
}

function text(value: unknown, max = 255): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function documentType(value: unknown): string {
  const normalized = text(value, 32).toUpperCase();
  return DOCUMENT_TYPES.has(normalized) ? normalized : 'OTHER';
}

async function readJson<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function loadFile(supabase: SupabaseClient, clientId: string, id: string): Promise<{ record: ClientFileRecord | null; error: string | null }> {
  const { data, error } = await supabase.from('client_files').select(CLIENT_FILE_COLUMNS).eq('id', id).eq('client_id', clientId).maybeSingle<ClientFileRecord>();
  return { record: data ?? null, error: error?.message ?? null };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const scope = accountDocumentReadScope(session.teamAccess);
  if (!scope) return NextResponse.json({ message: 'You do not have access to account documents.' }, { status: 403 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });

  const pageValue = request.nextUrl.searchParams.get('page');
  const page = Number(pageValue ?? 0);
  if (!Number.isSafeInteger(page) || page < 0) return NextResponse.json({ message: 'Invalid document page.' }, { status: 400 });
  const size = pageValue === null ? 200 : 100;
  const query = supabase
    .from('client_files')
    .select(scope === 'assigned' ? `${CLIENT_FILE_COLUMNS},account:clients!client_files_client_id_fkey!inner()` : CLIENT_FILE_COLUMNS)
    .eq('client_id', clientId);
  if (scope === 'assigned') query.eq('account.agent_user_id', session.user.id);
  const { data, error } = await query
    .order('uploaded_at', { ascending: false })
    .order('id')
    .range(page * size, page * size + size - 1)
    .returns<ClientFileRecord[]>();
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });

  return NextResponse.json((data ?? []).map(toClientFileView), { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * Saves an external document link reference. File bytes are stored through
 * /files/upload + /files/upload/complete; this route never claims an upload.
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });
  const editScope = accountRecordScope(session.teamAccess, 'documents.edit');
  if (!editScope) return NextResponse.json({ message: 'You do not have access to upload account documents.' }, { status: 403 });
  const accessDenied = await checkAccountUploadAccess(supabase, session.teamAccess, session.user.id, clientId);
  if (accessDenied) return accessDenied;

  const payload = await readJson<LinkPayload>(request);
  if (!payload) return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  if (payload.kind !== undefined && payload.kind !== 'link') {
    return NextResponse.json({ message: 'Use the upload flow to store document files.' }, { status: 400 });
  }

  const fileName = text(payload.file_name);
  if (!fileName) return NextResponse.json({ message: 'Name the document reference.' }, { status: 400 });
  const link = validateExternalUrl(payload.file_url);
  if (!link.ok) return NextResponse.json({ message: link.message }, { status: link.status });

  const notes = text(payload.notes, 1000);
  const { data, error } = await supabase
    .from('client_files')
    .insert([{
      client_id: clientId,
      file_name: fileName,
      file_url: link.url,
      file_type: documentType(payload.file_type),
      file_size: null,
      status: 'linked',
      metadata: { source_kind: 'link', added_by: apiActorName(session.user), ...(notes ? { notes } : {}) },
    }])
    .select(CLIENT_FILE_COLUMNS)
    .single<ClientFileRecord>();

  if (error || !data) return NextResponse.json({ message: friendlyErrorMessage(error) ?? 'The link could not be saved.' }, { status: 500 });
  return NextResponse.json(toClientFileView(data), { status: 201 });
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });
  const accessDenied = await checkAccountUploadAccess(supabase, session.teamAccess, session.user.id, clientId);
  if (accessDenied) return accessDenied;
  const payload = await readJson<LinkPayload>(request);
  if (!payload) return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  const fileId = payload.id;
  if (!isUuid(clientId) || !isUuid(fileId)) return NextResponse.json({ message: 'id is required.' }, { status: 400 });

  const existing = await loadFile(supabase, clientId, fileId);
  if (existing.error) return NextResponse.json({ message: existing.error }, { status: 500 });
  if (!existing.record) return NextResponse.json({ message: 'Document not found on this account.' }, { status: 404 });

  const kind = classifyClientFile(existing.record);
  const updates: Record<string, unknown> = {};
  if (payload.file_name !== undefined) {
    const name = text(payload.file_name);
    if (!name) return NextResponse.json({ message: 'Document name cannot be empty.' }, { status: 400 });
    updates.file_name = name;
  }
  if (payload.file_type !== undefined) updates.file_type = documentType(payload.file_type);
  if (payload.file_url !== undefined) {
    if (kind !== 'link') {
      return NextResponse.json({ message: 'Only link references have an editable address. Upload a new file to replace stored bytes.' }, { status: 400 });
    }
    const link = validateExternalUrl(payload.file_url);
    if (!link.ok) return NextResponse.json({ message: link.message }, { status: link.status });
    updates.file_url = link.url;
  }
  if (payload.notes !== undefined) {
    const notes = text(payload.notes, 1000);
    const metadata: Record<string, unknown> = { ...(existing.record.metadata ?? {}) };
    if (notes) metadata.notes = notes;
    else delete metadata.notes;
    updates.metadata = metadata;
  }
  if (payload.intake_review !== undefined) {
    if (kind !== 'stored') return NextResponse.json({ message: 'Reviewed intake requires a privately stored source document.' }, { status: 400 });
    try {
      updates.metadata = {
        ...(existing.record.metadata ?? {}), ...(isRecord(updates.metadata) ? updates.metadata : {}),
        intake_review: validateReviewedIntakeFields(payload.intake_review),
        intake_reviewed_at: new Date().toISOString(), intake_reviewed_by: session.user.id,
      };
    } catch (failure) {
      return NextResponse.json({ message: failure instanceof Error ? failure.message : 'Invalid reviewed fields.' }, { status: 400 });
    }
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });

  const { data, error } = await supabase
    .from('client_files')
    .update(updates)
    .eq('id', fileId)
    .eq('client_id', clientId)
    .select(CLIENT_FILE_COLUMNS)
    .single<ClientFileRecord>();
  if (error || !data) return NextResponse.json({ message: friendlyErrorMessage(error) ?? 'The document could not be updated.' }, { status: 500 });

  return NextResponse.json(toClientFileView(data), { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });
  const deleteScope = accountRecordScope(session.teamAccess, 'documents.delete');
  if (!deleteScope) return NextResponse.json({ message: 'You do not have access to remove account documents.' }, { status: 403 });
  const accessDenied = await checkAccountUploadAccess(supabase, session.teamAccess, session.user.id, clientId, 'documents.delete');
  if (accessDenied) return accessDenied;
  const payload = await readJson<{ id?: string }>(request);
  const fileId = payload?.id;
  if (!isUuid(clientId) || !isUuid(fileId)) return NextResponse.json({ message: 'id is required.' }, { status: 400 });

  const existing = await loadFile(supabase, clientId, fileId);
  if (existing.error) return NextResponse.json({ message: existing.error }, { status: 500 });
  if (!existing.record) return NextResponse.json({ message: 'Document not found on this account.' }, { status: 404 });

  const claimed = await supabase.rpc('claim_document_deletion', { p_account_id: clientId, p_file_id: fileId });
  if (claimed.error) return NextResponse.json({ message: friendlyErrorMessage(claimed.error) }, { status: operationErrorStatus(claimed.error.code) });
  const document: unknown = claimed.data;
  if (!isRecord(document) || document.id !== fileId || document.client_id !== clientId) {
    return NextResponse.json({ message: 'Document deletion could not be reserved. No stored file was removed.' }, { status: 500 });
  }
  const location = storedLocation({ metadata: isRecord(document.metadata) ? document.metadata : null });
  if (location) {
    const removed = await removeStoredObject(supabase, location);
    if (!removed.ok) return NextResponse.json({ message: `${removed.message} The document is reserved for deletion; retry Remove to finish.` }, { status: removed.status });
  }

  const { error } = await supabase.from('client_files').delete().eq('id', fileId).eq('client_id', clientId);
  if (error) {
    return NextResponse.json({ message: `Document record deletion failed${location ? ' after removing the stored file' : ''}. Retry Remove to finish: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
