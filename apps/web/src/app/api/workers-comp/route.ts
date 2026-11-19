import { NextRequest, NextResponse } from 'next/server';
import { appetiteCoverage, BUSINESS_FIELDS, EMPTY_DOSSIER_FINDINGS, EMPTY_OPPORTUNITY_PROFILE, isRecordType, type CarrierAppetiteDocument, type OpportunityMarket } from '@crm/shared';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';
import { parseWcEvidence, wcMatchingFacts, type WcWorkspace } from '../../../lib/workers-comp';
import { evaluateOpportunity } from '../../../lib/opportunity-matching';

async function handle(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Workers’ comp details are unavailable. Try again shortly.', 503);
    const input = request.method === 'GET' ? Object.fromEntries(request.nextUrl.searchParams) : await workspaceBody(request);
    if (!isRecordType(input.type) || !isUuid(input.id)) throw new WorkspaceError('Choose a saved lead or account.', 400);
    const args: { p_actor: string; p_type: string; p_id: string; p_entry?: string; p_expected?: number; p_evidence?: ReturnType<typeof parseWcEvidence>; p_remove?: boolean } =
      { p_actor: session.user.id, p_type: input.type, p_id: input.id };
    if (request.method !== 'GET') {
      if (!isUuid(input.entry_id) || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) {
        throw new WorkspaceError('Reload the document review before saving.', 400);
      }
      args.p_entry = input.entry_id; args.p_expected = input.revision;
      if (request.method === 'DELETE') args.p_remove = true;
      else args.p_evidence = parseWcEvidence(input.evidence);
    }
    const result = await db.rpc('workers_comp_workspace', args).single<WcWorkspace>();
    if (result.error) {
      if (['PGRST202', '42P01', '42883'].includes(result.error.code)) {
        console.error('[workers-comp/schema]', result.error);
        throw new WorkspaceError('Workers’ comp details are unavailable. Try again shortly.', 503);
      }
      throw databaseError(result.error);
    }
    if (!result.data) throw new WorkspaceError('Workers’ comp details could not load. Try again.', 503);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'workers-comp'); }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Workers’ comp matching is unavailable. Try again shortly.', 503);
    const input = await workspaceBody(request);
    if (!isRecordType(input.type) || !isUuid(input.id)) throw new WorkspaceError('Choose a saved lead or account.', 400);
    const result = await db.rpc('workers_comp_workspace', { p_actor: session.user.id, p_type: input.type, p_id: input.id }).single<WcWorkspace>();
    if (result.error) throw databaseError(result.error);
    if (!result.data) throw new WorkspaceError('Workers’ comp details could not load.', 503);
    const today = new Date().toISOString().slice(0, 10);
    const { facts, conflicts } = wcMatchingFacts(result.data.entries, today);
    const documents = await db.from('carrier_appetite_documents').select('id,revision,state,values,approved_by,approved_at')
      .eq('state', 'active').limit(1001).returns<CarrierAppetiteDocument[]>();
    if (documents.error) throw databaseError(documents.error);
    if (documents.data.length > 1000) throw new WorkspaceError('Narrow the active guide library before matching.', 503);
    const assessment = evaluateOpportunity({ ...EMPTY_OPPORTUNITY_PROFILE, facts },
      documents.data.filter((document) => appetiteCoverage(document.values.line).includes('workers compensation')), {
      scope_key: `${input.type}:${input.id}`, record_name: result.data.record_name, version: 0,
      findings: { ...EMPTY_DOSSIER_FINDINGS }, confirmations: [], observations: [], observations_total: 0, history_total: 0, page: 0,
    }, today, BUSINESS_FIELDS.filter((key) => key !== 'state' && key !== 'line' && facts[key] !== undefined));
    const markets: OpportunityMarket[] = assessment.markets.map((market) => ({ ...market,
      status: conflicts.length && market.status === 'possible_fit' ? 'needs_review' : market.status,
      reasons: [...conflicts, ...market.reasons.map((reason) => reason === 'Based on public business details. Confirm them before submitting.'
        ? 'Based on private, producer-reviewed documents. Confirm underwriting details before submitting.' : reason)],
    }));
    return NextResponse.json({ markets, conflicts }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'workers-comp/matching'); }
}
