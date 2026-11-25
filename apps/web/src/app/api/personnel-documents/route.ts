import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { issueUploadConfirmation, verifyUploadConfirmation } from '../../../lib/account-upload-access';
import { validateUploadRequest } from '../../../lib/account-documents';
import { WorkspaceError } from '../../../lib/record-scope';
import { assertSameOriginJson, databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';

const bucket = 'personnel-documents';
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']);
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return reply({ message: 'Personnel documents are unavailable.' }, 503);
  try {
    const manager = await db.rpc('personnel_manager', { p_actor: session.user.id });
    if (manager.error) throw databaseError(manager.error);
    if (typeof manager.data !== 'boolean') throw new Error('Personnel authorization returned invalid data.');
    if (request.nextUrl.searchParams.get('members') === 'true') {
      const members = await db.rpc('personnel_document_members', { p_actor: session.user.id });
      if (members.error) throw databaseError(members.error);
      return reply({ members: members.data });
    }
    const member = request.nextUrl.searchParams.get('member') ?? session.user.id;
    if (!isUuid(member)) throw new WorkspaceError('Choose a valid team member.', 400);
    const result = await db.rpc('list_personnel_documents', { p_actor: session.user.id, p_member: member });
    if (result.error) throw databaseError(result.error);
    return reply({ manager: manager.data, member, documents: result.data });
  } catch (error) { return workspaceApiError(error, 'personnel/list'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return reply({ message: 'Personnel documents are unavailable.' }, 503);
  try {
    assertSameOriginJson(request);
    const body = await workspaceBody(request);
    const manager = await db.rpc('personnel_manager', { p_actor: session.user.id });
    if (manager.error) throw databaseError(manager.error);
    if (manager.data !== true) throw new WorkspaceError('Personnel document management is required.', 403);
    if (body.action === 'ticket' || body.action === 'complete') {
      if (!isUuid(body.member)) throw new WorkspaceError('Choose a valid team member.', 400);
      const valid = validateUploadRequest({ fileName: body.file_name, contentType: body.content_type, size: body.file_size });
      if (!valid.ok) throw new WorkspaceError(valid.message, valid.status);
      if (!allowedTypes.has(valid.contentType) || !Number.isInteger(valid.size)) {
        throw new WorkspaceError('Upload a PDF, JPEG, PNG, WebP or text file.', 415);
      }
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new WorkspaceError('Document upload is unavailable.', 503);
      if (body.action === 'ticket') {
        const id = randomUUID();
        const path = `${body.member}/${id}/document`;
        const ticket = await db.storage.from(bucket).createSignedUploadUrl(path);
        if (ticket.error || !ticket.data?.signedUrl) throw new WorkspaceError('Could not start the private upload. Retry.', 503);
        const reserved = await db.rpc('reserve_personnel_upload', { p_actor: session.user.id, p_member: body.member, p_id: id });
        if (reserved.error) throw databaseError(reserved.error);
        return reply({ id, signed_url: ticket.data.signedUrl, content_type: valid.contentType,
          confirmation: issueUploadConfirmation(key, { ...valid, actor: session.user.id, path }) }, 201);
      }
      if (!isUuid(body.id) || typeof body.shared !== 'boolean' || typeof body.retain_until !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(body.retain_until)
        || Number.isNaN(Date.parse(`${body.retain_until}T00:00:00Z`))
        || new Date(`${body.retain_until}T00:00:00Z`).toISOString().slice(0, 10) !== body.retain_until) {
        throw new WorkspaceError('Choose a valid retention date and sharing option.', 400);
      }
      const path = `${body.member}/${body.id}/document`;
      if (!verifyUploadConfirmation(key, body.confirmation, { ...valid, actor: session.user.id, path })) {
        throw new WorkspaceError('This upload cannot be confirmed. Start a new upload.', 403);
      }
      const saved = await db.rpc('save_personnel_document', { p_actor: session.user.id, p_id: body.id, p_member: body.member,
        p_name: valid.fileName, p_path: path, p_type: valid.contentType, p_size: valid.size,
        p_retain: body.retain_until, p_shared: body.shared });
      if (saved.error) throw databaseError(saved.error);
      return reply({ ok: true }, 201);
    }
    if (!isUuid(body.id) || typeof body.version !== 'number' || !Number.isInteger(body.version)
      || body.version < 1 || body.version > 2147483647 || !['share', 'unshare', 'remove'].includes(String(body.action))) {
      throw new WorkspaceError('Choose a valid document action.', 400);
    }
    const changed = await db.rpc('change_personnel_document', {
      p_actor: session.user.id, p_id: body.id, p_version: body.version, p_action: body.action,
    });
    if (changed.error) throw databaseError(changed.error);
    if (body.action === 'remove') {
      if (typeof changed.data !== 'string') throw new Error('Document removal returned an invalid reference.');
      const removed = await db.storage.from(bucket).remove([changed.data]);
      if (removed.error) {
        console.error('[personnel/remove] Storage removal failed', removed.error.name);
        throw new WorkspaceError('The document is hidden but storage removal is incomplete. Reload and retry.', 503);
      }
      const finished = await db.rpc('finish_personnel_document_removal', { p_actor: session.user.id, p_id: body.id });
      if (finished.error) throw databaseError(finished.error);
    }
    return reply({ ok: true });
  } catch (error) { return workspaceApiError(error, 'personnel/change'); }
}
