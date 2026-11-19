import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../../lib/supabase-server';
import { agencyEnabled } from '../../../../../../lib/agency-membership';
import { leadOutreachContext } from '../../../../../../lib/lead-outreach-context';
import { rewriteOutreach } from '../../../../../../lib/outreach-ai';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../../../lib/workspace-api';
import { isUuid } from '../../../../../../lib/workspace-validation';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const { id } = await context.params;
    const body = await workspaceBody(request);
    if (!isUuid(id) || typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.trim().length > 1000
      || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0
      || typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 200
      || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 10000) {
      return NextResponse.json({ message: 'Provide a valid draft, its revision, and rewrite instructions of 1-1000 characters.' }, { status: 400 });
    }
    const item = await supabase.from('outreach_outbox').select('*').eq('id', id).maybeSingle();
    if (item.error) throw databaseError(item.error);
    if (!item.data) return NextResponse.json({ message: 'Draft not found.' }, { status: 404 });
    if ((agencyEnabled() || item.data.agent_user_id) && item.data.agent_user_id !== session.user.id) {
      return NextResponse.json({ message: 'Only the sequence owner can rewrite this draft.' }, { status: 403 });
    }
    if (item.data.status !== 'pending_approval' || item.data.draft_revision !== body.revision) {
      return NextResponse.json({ message: 'This draft changed or is no longer awaiting approval. Refresh before rewriting.' }, { status: 409 });
    }
    const lead = await supabase.from('leads').select('*').eq('id', item.data.lead_id).maybeSingle();
    if (lead.error) throw databaseError(lead.error);
    if (!lead.data) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
    const grounding = await leadOutreachContext(supabase, item.data.lead_id, session.user.id);
    const draft = await rewriteOutreach({ ...lead.data, ...grounding },
      { subject: body.subject, body: body.body }, body.instruction.trim(), item.data.step_number);
    if (!draft) return NextResponse.json({ message: 'AI rewriting is unavailable. Check the AI provider configuration and try again. Your original draft was not changed.' }, { status: 503 });
    const saved = await supabase.rpc('rewrite_outreach_draft', {
      p_outbox_id: id, p_actor_id: session.user.id, p_revision: body.revision,
      p_subject: draft.subject, p_body: draft.body, p_signals: draft.cited_signals,
    });
    if (saved.error) throw databaseError(saved.error);
    if (typeof saved.data !== 'number') throw new Error('The rewritten draft could not be verified.');
    return NextResponse.json({ ...draft, draft_revision: saved.data });
  } catch (error) {
    return workspaceApiError(error, 'outreach/rewrite');
  }
}
