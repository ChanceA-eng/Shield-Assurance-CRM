import { NextRequest, NextResponse } from 'next/server';
import { validEvidenceDate } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { opportunityDatabaseError } from '../../../../lib/opportunity-server';
import { parseOpportunityOutcome, parseOpportunitySettings } from '../../../../lib/opportunity-operations';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    await activeAgencyMember(db, session.user.id);
    const type = request.nextUrl.searchParams.get('type'), id = request.nextUrl.searchParams.get('id');
    if (id && (!isUuid(id) || !['lead', 'client'].includes(type ?? ''))) throw new WorkspaceError('Choose a valid business.', 400);
    const result = id
      ? await db.rpc('get_opportunity_operations', { p_actor: session.user.id, p_type: type, p_id: id })
      : await db.rpc('get_opportunity_dashboard', { p_actor: session.user.id });
    if (result.error) opportunityDatabaseError(result.error);
    return NextResponse.json(result.data, { headers });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/operations'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    await activeAgencyMember(db, session.user.id);
    const body = await workspaceBody(request);
    let result;
    if (body.action === 'settings') {
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new WorkspaceError('Reload OIP settings before saving.', 409);
      result = await db.rpc('save_opportunity_settings', { p_actor: session.user.id, p_expected: body.revision, p_config: parseOpportunitySettings(body.config) });
    } else {
      if (!isUuid(body.id) || !['lead', 'client', ...(body.action === 'watch' ? ['search'] : [])].includes(String(body.type))) throw new WorkspaceError('Choose a valid business or saved search.', 400);
      if (body.action === 'watch') {
        if (typeof body.enabled !== 'boolean') throw new WorkspaceError('Choose a watch status.', 400);
        result = await db.rpc('set_opportunity_watch', { p_actor: session.user.id, p_type: body.type, p_id: body.id, p_enabled: body.enabled });
      } else {
        if (!isUuid(body.request_id) || !isRecord(body.payload)) throw new WorkspaceError('Provide an action identity and reviewed values.', 400);
        let payload = body.payload;
        if (body.action === 'outcome') {
          const correction = payload.supersedes;
          if (correction !== undefined && !isUuid(correction)) throw new WorkspaceError('Choose a valid outcome to correct.', 400);
          payload = { ...parseOpportunityOutcome(payload), ...(correction ? { supersedes: correction } : {}) };
        }
        else if (['evidence', 'answer'].includes(String(body.action))) {
          if (!validEvidenceDate(payload.source_as_of) || payload.source_as_of > new Date().toISOString().slice(0, 10)) throw new WorkspaceError('Use a valid non-future source date.', 400);
          if (body.action === 'evidence' && ['authority', 'location'].includes(String(payload.kind))
            && (!validEvidenceDate(payload.previous_as_of) || payload.previous_as_of >= payload.source_as_of)) throw new WorkspaceError('Change signals require an earlier source date.', 400);
        } else if (!['request', 'relationship', 'relationship_review'].includes(String(body.action))) throw new WorkspaceError('Choose a supported action.', 400);
        result = await db.rpc('opportunity_operation', { p_actor: session.user.id, p_type: body.type, p_id: body.id,
          p_request: body.request_id, p_action: body.action, p_payload: payload });
      }
    }
    if (result.error) opportunityDatabaseError(result.error);
    return NextResponse.json(result.data, { headers });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/operation'); }
}
