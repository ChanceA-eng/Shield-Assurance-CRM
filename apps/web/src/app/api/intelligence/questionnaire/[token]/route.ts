import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { assertSameOriginJson, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { opportunityDatabaseError } from '../../../../../lib/opportunity-server';
import { isRecord } from '../../../../../lib/workspace-validation';
type Context = { params: Promise<{ token: string }> };
async function handle(request: NextRequest, context: Context, submit: boolean): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new WorkspaceError('Questionnaire not found.', 404);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The questionnaire is temporarily unavailable.', 503);
    let response: string | null = null, consent = false;
    if (submit) {
      assertSameOriginJson(request);
      const body = await workspaceBody(request);
      if (typeof body.response !== 'string' || !body.response.trim() || body.response.length > 3000 || body.consent !== true) throw new WorkspaceError('Provide a business-only response and consent to share it with your agent.', 400);
      response = body.response; consent = true;
    }
    const result = await db.rpc('public_opportunity_questionnaire', { p_hash: createHash('sha256').update(token).digest('hex'), p_response: response, p_consent: consent });
    if (result.error) opportunityDatabaseError(result.error);
    const data: unknown = result.data;
    if (!isRecord(data) || typeof data.submitted !== 'boolean' || (submit ? data.submitted !== true
      : typeof data.questions !== 'string' || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)))) {
      throw new WorkspaceError('The questionnaire response could not be verified.', 503);
    }
    return NextResponse.json(submit ? { submitted: true } : { questions: data.questions, submitted: data.submitted, expires_at: data.expires_at },
      { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/questionnaire'); }
}
export const GET = (request: NextRequest, context: Context): Promise<NextResponse> => handle(request, context, false);
export const POST = (request: NextRequest, context: Context): Promise<NextResponse> => handle(request, context, true);
