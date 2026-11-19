import { NextRequest, NextResponse } from 'next/server';
import { validEvidenceDate } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { parseDossierFindings } from '../../../../lib/dossier';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const params = request.nextUrl.searchParams;
    const type = params.get('type'), id = params.get('id'), page = Number(params.get('page') ?? 0);
    if (!['lead', 'client'].includes(String(type)) || !isUuid(id) || !Number.isInteger(page) || page < 0 || page > 10000) {
      throw new WorkspaceError('Choose a valid lead/account and history page.', 400);
    }
    const result = await db.rpc('get_intelligence_dossier', { p_actor: session.user.id, p_type: type, p_id: id, p_page: page });
    if (result.error) throw databaseError(result.error);
    if (!isRecord(result.data) || typeof result.data.scope_key !== 'string' || !Array.isArray(result.data.observations)
      || !Array.isArray(result.data.confirmations) || !Number.isInteger(result.data.version)) {
      throw new WorkspaceError('Dossier evidence could not be verified.', 503);
    }
    return NextResponse.json(result.data);
  } catch (failure) { return workspaceApiError(failure, 'intelligence/dossier'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const body = await workspaceBody(request);
    if (!['lead', 'client'].includes(String(body.type)) || !isUuid(body.id) || !isUuid(body.request_id)
      || typeof body.scope_key !== 'string' || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version) || body.expected_version < 0
      || typeof body.reference !== 'string' || !body.reference.trim() || body.reference.length > 1000
      || !validEvidenceDate(body.source_as_of) || body.source_as_of > new Date().toISOString().slice(0, 10)) {
      throw new WorkspaceError('Provide the current dossier, evidence reference and a non-future confirmation date.', 400);
    }
    const findings = parseDossierFindings(body.findings);
    const result = await db.rpc('save_intelligence_dossier', { p_actor: session.user.id, p_type: body.type, p_id: body.id,
      p_scope: body.scope_key, p_expected: body.expected_version, p_request: body.request_id,
      p_findings: findings, p_reference: body.reference.trim(), p_source_as_of: body.source_as_of });
    if (result.error) throw databaseError(result.error);
    if (!isRecord(result.data) || !Number.isInteger(result.data.version) || typeof result.data.already_saved !== 'boolean') {
      throw new WorkspaceError('Confirmation status is uncertain. Retry these same findings before starting another save.', 503);
    }
    return NextResponse.json(result.data);
  } catch (failure) { return workspaceApiError(failure, 'intelligence/dossier-save'); }
}
