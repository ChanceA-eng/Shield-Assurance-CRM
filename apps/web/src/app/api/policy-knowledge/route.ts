import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { activeAgencyMember } from '../../../lib/agency-membership';
import { requireAgencyOwner } from '../../../lib/agency-access';
import { WorkspaceError, resolveRecordScope } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';
import { parsePolicyKnowledge, assertDeidentifiedPolicyKnowledge } from '../../../lib/policy-knowledge';
import { publishReviewedPolicyWording, withdrawReviewedPolicyWording } from '../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function access(request: NextRequest) {
  const session = await getApiSession(request);
  if (session.error) throw new WorkspaceError('Session verification failed. Sign in again or check authentication setup.', session.error.status);
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  const member = await activeAgencyMember(db, session.user.id);
  return { db, actor: session.user.id, owner: member.role === 'owner' };
}
async function checkPrivateValues(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, input: ReturnType<typeof parsePolicyKnowledge>): Promise<void> {
  await resolveRecordScope(db, { type: 'client', id: input.account_id });
  const [account, policies] = await Promise.all([
    db.from('clients').select('full_name,email,phone,address').eq('id', input.account_id).single(),
    db.from('policies').select('policy_number,insured_name,email,phone,address', { count: 'exact' }).eq('client_id', input.account_id),
  ]);
  if (account.error) throw databaseError(account.error);
  if (policies.error) throw databaseError(policies.error);
  if (policies.count !== policies.data.length) throw new WorkspaceError('This account has more policy records than can be checked safely. Ask the administrator to review privacy checks before submitting.', 422);
  const tokens: string[] = [];
  for (const row of [account.data, ...policies.data]) {
    for (const value of Object.values(row)) if (typeof value === 'string' && value.trim()) tokens.push(value);
  }
  assertDeidentifiedPolicyKnowledge(input, tokens);
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor, owner } = await access(request);
    const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new WorkspaceError('Select a valid review page.', 400);
    let query = db.from('policy_knowledge_candidates').select('*').order('updated_at', { ascending: false }).order('id')
      .range(page * 100, page * 100 + 100);
    if (!owner) query = query.eq('created_by', actor);
    const result = await query;
    if (result.error) {
      if (result.error.code === '42P01' || result.error.code === 'PGRST205') {
        throw new WorkspaceError('Policy knowledge review is not installed. Apply the reviewed policy_knowledge_review migration before submitting documents.', 503);
      }
      throw databaseError(result.error);
    }
    return NextResponse.json({ candidates: result.data.slice(0, 100), has_more: result.data.length > 100, can_review: owner }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'policy-knowledge/list'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request);
    const body = await workspaceBody(request);
    const values = parsePolicyKnowledge(body);
    if (!isUuid(body.id) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
      throw new WorkspaceError('Provide a candidate ID and saved revision.', 400);
    }
    await checkPrivateValues(db, values);
    const result = await db.rpc('save_policy_knowledge_candidate', {
      p_actor: actor, p_id: body.id, p_expected: body.revision, p_values: values,
    });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data);
  } catch (failure) { return workspaceApiError(failure, 'policy-knowledge/submit'); }
}
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request);
    await requireAgencyOwner(db, actor);
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 1) {
      throw new WorkspaceError('Select a candidate and its saved revision.', 400);
    }
    if (body.action === 'withdraw') {
      await withdrawReviewedPolicyWording(actor, body.id, Number(body.revision));
      return NextResponse.json({ withdrawn: true });
    }
    if (!['approve', 'reject', 'publish'].includes(String(body.action))) throw new WorkspaceError('Select approve, reject, publish or withdraw.', 400);
    const current = await db.from('policy_knowledge_candidates').select('*').eq('id', body.id).single();
    if (current.error) throw databaseError(current.error);
    if (current.data.revision !== body.revision) throw new WorkspaceError('Candidate changed. Reload before reviewing.', 409);
    if (body.action !== 'reject') {
      const values = parsePolicyKnowledge({ ...current.data, privacy_confirmed: body.privacy_confirmed, rights_confirmed: body.rights_confirmed });
      await checkPrivateValues(db, values);
    }
    if (body.action === 'publish') {
      const documentId = await publishReviewedPolicyWording(actor, body.id, Number(body.revision));
      return NextResponse.json({ document_id: documentId });
    }
    const result = await db.rpc('review_policy_knowledge_candidate', {
      p_actor: actor, p_id: body.id, p_expected: body.revision, p_approve: body.action === 'approve',
    });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data);
  } catch (failure) { return workspaceApiError(failure, 'policy-knowledge/review'); }
}
