import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../../../lib/agency-access';
import { getSupabaseServerClient } from '../../../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../../../lib/workspace-validation';

function validPreview(value: unknown): value is {
  rule_id: string; rule_revision: number; event: string; action_type: string;
  eligible_count: number; fingerprint: string; batch_limit: number; may_use_ai: boolean;
} {
  return isRecord(value) && isUuid(value.rule_id) && typeof value.rule_revision === 'number'
    && Number.isSafeInteger(value.rule_revision) && value.rule_revision > 0
    && typeof value.event === 'string' && typeof value.action_type === 'string'
    && typeof value.eligible_count === 'number' && Number.isSafeInteger(value.eligible_count) && value.eligible_count >= 0
    && typeof value.fingerprint === 'string' && /^[0-9a-f]{32}$/.test(value.fingerprint)
    && value.batch_limit === 100 && typeof value.may_use_ai === 'boolean';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const rule = request.nextUrl.searchParams.get('rule');
    if (!rule || !isUuid(rule)) throw new WorkspaceError('Choose a valid workflow rule.', 400);
    const result = await db.rpc('preview_workflow_backlog', { p_rule: rule });
    if (result.error) throw databaseError(result.error);
    if (!validPreview(result.data)) throw new Error('Workflow backlog preview returned an invalid result.');
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'settings/workflow-backlog-preview'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const body = await workspaceBody(request);
    if (Object.keys(body).some((key) => !['rule_id', 'expected_revision', 'eligible_count', 'fingerprint', 'confirmed'].includes(key))
      || typeof body.rule_id !== 'string' || !isUuid(body.rule_id)
      || typeof body.expected_revision !== 'number' || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1
      || typeof body.eligible_count !== 'number' || !Number.isSafeInteger(body.eligible_count) || body.eligible_count < 0
      || typeof body.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(body.fingerprint) || body.confirmed !== true) {
      throw new WorkspaceError('Preview and explicitly confirm one current workflow backlog before queueing it.', 400);
    }
    const result = await db.rpc('apply_workflow_backlog', {
      p_actor: session.user.id, p_rule: body.rule_id, p_expected_revision: body.expected_revision,
      p_expected_count: body.eligible_count, p_expected_fingerprint: body.fingerprint,
    });
    if (result.error) throw databaseError(result.error);
    if (!isRecord(result.data) || typeof result.data.queued_count !== 'number' || !Number.isInteger(result.data.queued_count)
      || result.data.queued_count < 0 || typeof result.data.skipped_count !== 'number'
      || !Number.isInteger(result.data.skipped_count) || result.data.skipped_count < 0
      || typeof result.data.remaining_count !== 'number' || !Number.isInteger(result.data.remaining_count)
      || result.data.remaining_count < 0 || result.data.rule_revision !== body.expected_revision
      || result.data.preview_only !== false) {
      throw new Error('Workflow backlog application returned an invalid result.');
    }
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'settings/workflow-backlog-apply'); }
}
