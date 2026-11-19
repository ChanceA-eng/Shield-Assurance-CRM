import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { opportunityDatabaseError } from '../../../../lib/opportunity-server';
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const body = await workspaceBody(request);
    if (!['lead', 'client'].includes(String(body.type)) || !isUuid(body.id) || !isUuid(body.request_id)
      || typeof body.revoke !== 'boolean') throw new WorkspaceError('Choose a saved business request.', 400);
    const token = randomBytes(32).toString('base64url');
    const result = await db.rpc('share_opportunity_questionnaire', { p_actor: session.user.id, p_type: body.type, p_id: body.id,
      p_request: body.request_id, p_hash: createHash('sha256').update(token).digest('hex'), p_revoke: body.revoke });
    if (result.error) opportunityDatabaseError(result.error);
    const data: unknown = result.data;
    if (!isRecord(data) || (body.revoke ? data.revoked !== true
      : typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)))) throw new WorkspaceError('The questionnaire link could not be verified.', 503);
    return NextResponse.json(body.revoke ? { revoked: true } : { expires_at: data.expires_at, path: `/intelligence/questionnaire/${token}` }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/questionnaire-share'); }
}
