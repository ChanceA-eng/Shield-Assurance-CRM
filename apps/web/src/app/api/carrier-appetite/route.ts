import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { WorkspaceError } from '../../../lib/record-scope';
import { workspaceBody, workspaceApiError, databaseError } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';
import { ACCOUNT_DOCUMENT_BUCKET, validateUploadRequest, sanitizeDocumentName, verifyStoredObject, downloadStoredObject, contentDisposition } from '../../../lib/account-documents';
import { parseAppetitePages, parseCarrierAppetite } from '../../../lib/carrier-appetite';
import { interpretCarrierGuide } from '../../../lib/carrier-appetite-ai';
import type { CarrierAppetiteDocument } from '@crm/shared';
import { hasTeamPermission, requireTeamPermission } from '../../../lib/team-request-access';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
async function access(request: NextRequest) {
  const session = await getApiSession(request);
  if (session.error) throw new WorkspaceError('Sign in before accessing carrier appetite.', session.error.status);
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  return { db, actor: session.user.id, teamAccess: session.teamAccess };
}
function installed(error: { code?: string; message: string }): never {
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) {
    throw new WorkspaceError('Carrier appetite is not installed. Apply the reviewed 20261111010000_carrier_appetite migration before using this feature.', 503);
  }
  throw databaseError(error);
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, teamAccess } = await access(request);
    const canManage = hasTeamPermission(teamAccess, 'knowledge.edit');
    const overlaps = await db.rpc('carrier_appetite_source_overlaps');
    if (overlaps.error) installed(overlaps.error);
    const id = request.nextUrl.searchParams.get('id');
    if (id) {
      if (!isUuid(id)) throw new WorkspaceError('Select a valid carrier document.', 400);
      let query = db.from('carrier_appetite_documents').select('*').eq('id', id);
      if (!canManage) query = query.eq('state', 'active');
      const current = await query.maybeSingle<CarrierAppetiteDocument>();
      if (current.error) installed(current.error);
      if (!current.data) throw new WorkspaceError('Carrier document not found.', 404);
      if (request.nextUrl.searchParams.get('download') === '1') {
        const result = await downloadStoredObject(db, { bucket: ACCOUNT_DOCUMENT_BUCKET, path: current.data.storage_path });
        if (!result.ok) throw new WorkspaceError(result.message, result.status);
        return new NextResponse(result.blob, { headers: { ...headers, 'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDisposition(current.data.file_name, 'attachment') } });
      }
      return NextResponse.json({ document: current.data, can_manage: canManage, overlapping_sources: overlaps.data }, { headers });
    }
    const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Select a valid page.', 400);
    let query = db.from('carrier_appetite_documents').select('id,revision,state,values,file_name,approved_at,updated_at')
      .gt('revision', 0).order('updated_at', { ascending: false }).order('id').range(page * 20, page * 20 + 20);
    if (!canManage) query = query.eq('state', 'active');
    const result = await query;
    if (result.error) installed(result.error);
    return NextResponse.json({ documents: result.data.slice(0, 20), has_more: result.data.length > 20, can_manage: canManage, overlapping_sources: overlaps.data }, { headers });
  } catch (failure) { return workspaceApiError(failure, 'carrier-appetite/get'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor, teamAccess } = await access(request);
    requireTeamPermission(teamAccess, 'knowledge.edit');
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new WorkspaceError('Provide the document ID and saved revision.', 400);
    if (body.action === 'reserve') {
      const file = validateUploadRequest({ fileName: body.file_name, contentType: body.content_type, size: body.file_size });
      if (!file.ok) throw new WorkspaceError(file.message, file.status);
      if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.contentType)) {
        throw new WorkspaceError('Use PDF, PNG, JPEG, WebP, TXT, CSV or XLSX.', 400);
      }
      const path = `carrier-appetite/${body.id}/${sanitizeDocumentName(file.fileName)}`;
      const reserved = await db.rpc('save_carrier_appetite', { p_actor: actor, p_id: body.id, p_expected: body.revision,
        p_action: 'reserve', p_input: { file_name: file.fileName, content_type: file.contentType, file_size: file.size, storage_path: path } });
      if (reserved.error) installed(reserved.error);
      const source = await verifyStoredObject(db, path, file.size);
      if (source.ok) return NextResponse.json({ already_uploaded: true, content_type: file.contentType }, { headers });
      if (source.status >= 500) throw new WorkspaceError(source.message, source.status);
      const ticket = await db.storage.from(ACCOUNT_DOCUMENT_BUCKET).createSignedUploadUrl(path);
      if (ticket.error || !ticket.data?.signedUrl) throw new WorkspaceError('Private source upload could not start. Retry this upload.', 502);
      return NextResponse.json({ signed_url: ticket.data.signedUrl, content_type: file.contentType }, { headers });
    }
    const current = await db.from('carrier_appetite_documents').select('*').eq('id', body.id).maybeSingle<CarrierAppetiteDocument & { file_size: number; content_type: string }>();
    if (current.error) installed(current.error);
    if (!current.data) throw new WorkspaceError('Start the private source upload first.', 404);
    if (body.action === 'interpret' || body.action === 'interpret_saved') {
      if (current.data.revision !== body.revision) throw new WorkspaceError('This guide changed. Reopen it before reading with AI.', 409);
      const pages = current.data.revision > 0 ? current.data.pages : parseAppetitePages(body.pages);
      const source = await downloadStoredObject(db, { bucket: ACCOUNT_DOCUMENT_BUCKET, path: current.data.storage_path });
      if (!source.ok) throw new WorkspaceError(source.message, source.status);
      if (source.blob.size !== current.data.file_size) throw new WorkspaceError('The private guide is incomplete. Upload the original file again.', 409);
      const reading = await interpretCarrierGuide(db, new Uint8Array(await source.blob.arrayBuffer()), current.data.content_type, pages, body.retry === true);
      if (body.action === 'interpret_saved') {
        const previous = current.data.values;
        const values = parseCarrierAppetite({ ...reading, carrier: previous.carrier || reading.carrier, title: previous.title,
          access: previous.access, access_reference: previous.access_reference, rights_reference: previous.rights_reference,
          effective_on: previous.effective_on, expires_on: previous.expires_on }, pages);
        const applied = await db.rpc('apply_carrier_appetite_reading', { p_actor: actor, p_id: body.id, p_expected: body.revision, p_values: values });
        if (applied.error) installed(applied.error);
        return NextResponse.json({ document: applied.data }, { headers });
      }
      return NextResponse.json({ values: reading }, { headers });
    }
    let input: object = {};
    if (body.action === 'save') {
      const pages = parseAppetitePages(body.pages);
      const values = parseCarrierAppetite(body.values, pages);
      const source = await verifyStoredObject(db, current.data.storage_path, current.data.file_size);
      if (!source.ok) throw new WorkspaceError(source.message, source.status);
      input = { pages, values };
    } else if (body.action === 'activate') {
      parseCarrierAppetite(current.data.values, current.data.pages);
    } else if (body.action !== 'withdraw') throw new WorkspaceError('Choose save, activate or withdraw.', 400);
    const result = await db.rpc('save_carrier_appetite', { p_actor: actor, p_id: body.id, p_expected: body.revision, p_action: body.action, p_input: input });
    if (result.error) installed(result.error);
    return NextResponse.json(result.data, { headers });
  } catch (failure) { return workspaceApiError(failure, 'carrier-appetite/change'); }
}
