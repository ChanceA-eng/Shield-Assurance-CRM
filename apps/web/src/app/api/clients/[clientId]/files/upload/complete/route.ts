import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../../../../../lib/api-auth';
import { checkAccountUploadAccess, verifyUploadConfirmation } from '../../../../../../../lib/account-upload-access';
import { validateReviewedIntakeFields, type ReviewedIntakeFields } from '../../../../../../../lib/policy-document-intake';
import {
  ACCOUNT_DOCUMENT_BUCKET,
  CLIENT_FILE_COLUMNS,
  documentTypeLabel,
  isDocumentPathForClient,
  isUuid,
  storedLocation,
  toClientFileView,
  validateUploadRequest,
  verifyStoredObject,
  type ClientFileRecord,
} from '../../../../../../../lib/account-documents';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

/** Records an uploaded document only after the bytes are confirmed in private storage. */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });

  let payload: { storage_path?: unknown; file_name?: unknown; content_type?: unknown; file_size?: unknown; notes?: unknown; intake_review?: unknown; confirmation?: unknown };
  let review: ReviewedIntakeFields | undefined;
  try {
    payload = (await request.json()) as typeof payload;
    if (payload.intake_review !== undefined) review = validateReviewedIntakeFields(payload.intake_review);
  } catch (failure) {
    return NextResponse.json({ message: failure instanceof Error ? failure.message : 'Invalid upload review.' }, { status: 400 });
  }

  const validated = validateUploadRequest({ fileName: payload.file_name, contentType: payload.content_type, size: payload.file_size });
  if (!validated.ok) return NextResponse.json({ message: validated.message }, { status: validated.status });
  if (!isDocumentPathForClient(payload.storage_path, clientId)) {
    return NextResponse.json({ message: 'The upload reference does not belong to this account.' }, { status: 400 });
  }
  const path = payload.storage_path;
  const restricted = session.teamAccess?.mode !== 'legacy';
  if (restricted) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !verifyUploadConfirmation(key, payload.confirmation, { ...validated, actor: session.user.id, path })) {
      return NextResponse.json({ message: 'This upload cannot be confirmed. Start a new upload.' }, { status: 403 });
    }
    const accessDenied = await checkAccountUploadAccess(supabase, session.teamAccess, session.user.id, clientId);
    if (accessDenied) return accessDenied;
  }

  const verified = await verifyStoredObject(supabase, path, validated.size);
  if (!verified.ok) return NextResponse.json({ message: verified.message }, { status: verified.status });

  const notes = typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : '';
  const { data, error } = await supabase
    .from('client_files')
    .insert([{
      client_id: clientId,
      file_name: validated.fileName,
      file_url: null,
      file_type: documentTypeLabel(validated.contentType),
      file_size: verified.size,
      status: 'stored',
      metadata: {
        source_kind: 'stored',
        storage: { bucket: ACCOUNT_DOCUMENT_BUCKET, path, content_type: validated.contentType, size: verified.size },
        uploaded_by: apiActorName(session.user),
        original_name: validated.fileName,
        ...(notes ? { notes } : {}),
        ...(review ? { intake_review: review, intake_reviewed_at: new Date().toISOString(), intake_reviewed_by: session.user.id } : {}),
      },
    }])
    .select(CLIENT_FILE_COLUMNS)
    .single<ClientFileRecord>();

  if (error || !data) {
    if (error?.code === '23505') {
      const existing = await supabase.from('client_files').select(CLIENT_FILE_COLUMNS)
        .eq('client_id', clientId).eq('metadata->storage->>path', path)
        .eq('metadata->storage->>bucket', ACCOUNT_DOCUMENT_BUCKET).maybeSingle<ClientFileRecord>();
      if (existing.error) return NextResponse.json({ message: `Could not recover the recorded upload: ${existing.error.message}` }, { status: 500 });
      const location = existing.data ? storedLocation(existing.data) : null;
      if (existing.data && existing.data.file_name === validated.fileName && location?.size === validated.size
        && location.content_type === validated.contentType) {
        return NextResponse.json(toClientFileView(existing.data), { status: 200 });
      }
      return NextResponse.json({ message: 'This upload reference was already used for a different document.' }, { status: 409 });
    }
    return NextResponse.json({ message: `The document record could not be confirmed: ${error?.message ?? 'no row returned'}. The uploaded bytes were retained; retry to confirm the same upload.` }, { status: 500 });
  }

  return NextResponse.json(toClientFileView(data), { status: 201 });
}
