import { NextRequest, NextResponse } from 'next/server';
import { type OpportunityDraft, type RecordTarget } from '@crm/shared';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { isUuid } from '../../../../../lib/workspace-validation';
import { opportunityContext, opportunityDatabaseError } from '../../../../../lib/opportunity-server';
import { POST as sendCommunication } from '../../../communication-log/route';
export const runtime = 'nodejs';
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const body = await workspaceBody(request);
    if ((body.type !== 'lead' && body.type !== 'client') || !isUuid(body.id) || !isUuid(body.draft_id)
      || (body.email_provider !== 'default' && body.email_provider !== 'gmail')) throw new WorkspaceError('Choose an approved opportunity draft and email provider.', 400);
    const target: RecordTarget = { type: body.type, id: body.id };
    const context = await opportunityContext(db, session.user.id, target);
    const current = await db.from('opportunity_drafts').select('*').eq('id', body.draft_id).eq('actor_id', session.user.id)
      .eq('scope_key', context.dossier.scope_key).maybeSingle<OpportunityDraft>();
    if (current.error) opportunityDatabaseError(current.error);
    const draft = current.data;
    if (!draft) throw new WorkspaceError('Opportunity draft not found.', 404);
    const claim = await db.rpc('claim_opportunity_send', { p_actor: session.user.id, p_type: target.type, p_id: target.id,
      p_draft: draft.id, p_request: draft.request_id, p_subject: draft.subject, p_body: draft.body });
    if (claim.error) opportunityDatabaseError(claim.error);
    let response: NextResponse;
    try {
      const headers = new Headers(request.headers); headers.set('Content-Type', 'application/json');
      response = await sendCommunication(new NextRequest(new URL('/api/communication-log', request.url), {
        method: 'POST', headers,
        body: JSON.stringify({ [target.type === 'lead' ? 'lead_id' : 'client_id']: target.id, channel: 'email',
          direction: 'outbound', subject: draft.subject, body: draft.body, request_id: draft.request_id,
          to: context.recipient, automation_type: 'manual', ...(body.email_provider === 'gmail' ? { email_provider: 'gmail' } : {}) }),
      }));
    } catch (failure) {
      const recorded = await db.rpc('finish_opportunity_send', { p_actor: session.user.id, p_draft: draft.id, p_state: 'uncertain' });
      if (recorded.error) console.error('[opportunity/send-outcome]', recorded.error);
      console.error('[opportunity/send]', failure);
      throw new WorkspaceError('Delivery outcome is uncertain. Check conversation history and provider status; do not resend.', 502);
    }
    const outcome = await db.rpc('finish_opportunity_send', { p_actor: session.user.id, p_draft: draft.id, p_state: response.ok ? 'sent' : 'uncertain' });
    if (outcome.error) {
      console.error('[opportunity/send-outcome]', outcome.error);
      throw new WorkspaceError('Delivery was attempted but its review status could not be saved. Check conversation history; do not resend.', 502);
    }
    if (!response.ok) {
      const payload: { message?: string } = await response.json();
      return NextResponse.json({ message: `${payload.message ?? 'Delivery was not confirmed.'} This opportunity draft is locked. Check conversation history and provider status before composing another message.` }, { status: response.status });
    }
    return response;
  } catch (failure) { return workspaceApiError(failure, 'opportunity/send'); }
}
