import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { workspaceApiError, databaseError } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../../lib/workspace-validation';
import { contentDisposition } from '../../../../../lib/account-documents';
import { prospectDb, prospectRpc } from '../../../../../lib/prospect-questionnaire-server';

export async function GET(request: NextRequest, context: { params: Promise<{ fileId: string }> }): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const { fileId } = await context.params;
    if (!isUuid(fileId)) throw new WorkspaceError('Choose a document.', 400);
    const db = prospectDb();
    const found = await db.from('prospect_questionnaire_files').select('request_id').eq('id', fileId).maybeSingle<{ request_id: string }>();
    if (found.error) throw databaseError(found.error);
    if (!found.data) throw new WorkspaceError('Document not found.', 404);
    const file = await prospectRpc(db, 'prospect_questionnaire_staff', { p_actor: session.user.id, p_action: 'file', p_data: { id: found.data.request_id, file_id: fileId } });
    if (!isRecord(file) || typeof file.storage_path !== 'string' || typeof file.name !== 'string' || typeof file.digest !== 'string') {
      throw new WorkspaceError('File-safety receipt could not be verified.', 503);
    }
    const stored = await db.storage.from('prospect-documents').download(file.storage_path);
    if (stored.error || !stored.data) { console.error('[questionnaire/download] Storage read failed.'); throw new WorkspaceError('Document could not be downloaded.', 503); }
    const bytes = Buffer.from(await stored.data.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024 || bytes.length !== file.size) {
      throw new WorkspaceError('Stored document does not match its safety receipt.', 409);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== file.digest) throw new WorkspaceError('Stored document changed after its safety check.', 409);
    return new NextResponse(bytes, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length),
      'Content-Disposition': contentDisposition(file.name, 'attachment'), 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } });
  } catch (failure) { return workspaceApiError(failure, 'questionnaires/download'); }
}
