import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { contentDisposition, downloadStoredObject } from '../../../../lib/account-documents';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Personnel documents are unavailable.' }, { status: 503 });
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw new WorkspaceError('Choose a valid document.', 400);
    const result = await db.rpc('read_personnel_document', { p_actor: session.user.id, p_id: id });
    if (result.error) throw databaseError(result.error);
    const rows: unknown = result.data;
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('Personnel document lookup returned invalid data.');
    if (!rows.length) throw new WorkspaceError('Document not found.', 404);
    const file: unknown = rows[0];
    if (!isRecord(file) || typeof file.file_name !== 'string' || typeof file.storage_path !== 'string'
      || typeof file.content_type !== 'string' || typeof file.file_size !== 'number') {
      throw new Error('Personnel document metadata is invalid.');
    }
    const stored = await downloadStoredObject(db, { bucket: 'personnel-documents', path: file.storage_path });
    if (!stored.ok) throw new WorkspaceError('Document download is unavailable. Retry.', stored.status);
    const bytes = await stored.blob.arrayBuffer();
    return new NextResponse(bytes, { headers: {
      'Content-Type': file.content_type, 'Content-Length': String(bytes.byteLength),
      'Content-Disposition': contentDisposition(file.file_name, 'attachment'),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return workspaceApiError(error, 'personnel/download'); }
}
