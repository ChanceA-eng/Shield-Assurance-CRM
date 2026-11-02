import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../../../lib/api-auth';
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

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });

  const { data, error } = await supabase
    .from('client_files')
    .select(CLIENT_FILE_COLUMNS)
    .eq('client_id', clientId)
    .order('uploaded_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  return NextResponse.json(((data ?? []) as ClientFileRecord[]).map(toClientFileView), { status: 200 });
}

/**
 * Saves an external document link reference. File bytes are stored through
 * /files/upload + /files/upload/complete; this route never claims an upload.
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });

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

  if (error || !data) return NextResponse.json({ message: error?.message ?? 'The link could not be saved.' }, { status: 500 });
  return NextResponse.json(toClientFileView(data), { status: 201 });
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { clientId } = await context.params;
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
  if (Object.keys(updates).length === 0) return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });

  const { data, error } = await supabase
    .from('client_files')
    .update(updates)
    .eq('id', fileId)
    .eq('client_id', clientId)
    .select(CLIENT_FILE_COLUMNS)
    .single<ClientFileRecord>();
  if (error || !data) return NextResponse.json({ message: error?.message ?? 'The document could not be updated.' }, { status: 500 });

  return NextResponse.json(toClientFileView(data), { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { clientId } = await context.params;
  const payload = await readJson<{ id?: string }>(request);
  const fileId = payload?.id;
  if (!isUuid(clientId) || !isUuid(fileId)) return NextResponse.json({ message: 'id is required.' }, { status: 400 });

  const existing = await loadFile(supabase, clientId, fileId);
  if (existing.error) return NextResponse.json({ message: existing.error }, { status: 500 });
  if (!existing.record) return NextResponse.json({ message: 'Document not found on this account.' }, { status: 404 });

  // Remove the bytes first so a deleted record never leaves an orphaned private file behind.
  const location = storedLocation(existing.record);
  if (location) {
    const removed = await removeStoredObject(supabase, location);
    if (!removed.ok) return NextResponse.json({ message: `${removed.message} The document was kept.` }, { status: removed.status });
  }

  const { error } = await supabase.from('client_files').delete().eq('id', fileId).eq('client_id', clientId);
  if (error) {
    if (location) {
      await supabase
        .from('client_files')
        .update({ status: 'storage_removed', metadata: { ...(existing.record.metadata ?? {}), storage_removed_at: new Date().toISOString() } })
        .eq('id', fileId)
        .eq('client_id', clientId);
    }
    return NextResponse.json({ message: `The stored file was removed, but the document record could not be deleted: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
