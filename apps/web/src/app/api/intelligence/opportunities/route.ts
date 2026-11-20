import { NextRequest, NextResponse } from 'next/server';
import { type RecordTarget, type OpportunityDraft } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled, agentSender } from '../../../../lib/agency-membership';
import { getOutreachSender } from '../../../../lib/marketing-profile';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isRecord, isUuid, absoluteDateTime } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { opportunityContext, opportunityWorkspace, opportunityDatabaseError, permissionFirstDraft } from '../../../../lib/opportunity-server';
import { parseOpportunityProfile } from '../../../../lib/opportunity-matching';
import { currentDossierDraftFacts } from '../../../../lib/dossier';
import { draftOutreach } from '../../../../lib/outreach-ai';
import { eligibleAiMessages, type OutreachConversation } from '../../../../lib/lead-outreach-context';
import { hasTeamPermission } from '../../../../lib/team-request-access';
const headers = { 'Cache-Control': 'private, no-store' };
export const runtime = 'nodejs';
export const maxDuration = 60;
function target(type: unknown, id: unknown): RecordTarget {
  if ((type !== 'lead' && type !== 'client') || !isUuid(id)) throw new WorkspaceError('Choose a valid business lead or account.', 400);
  return { type, id };
}
async function access(request: NextRequest) {
  const session = await getApiSession(request);
  if (session.error) throw new WorkspaceError('Sign in before using opportunities.', session.error.status);
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  const member = await activeAgencyMember(db, session.user.id);
  return { db, actor: session.user.id, member, teamAccess: session.teamAccess };
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor, member, teamAccess } = await access(request), params = request.nextUrl.searchParams;
    if (params.get('id')) {
      const selected = target(params.get('type'), params.get('id'));
      const context = await opportunityContext(db, actor, selected);
      const drafts = await db.from('opportunity_drafts').select('id,scope_key,revision,state,subject,body,request_id,evidence_token')
        .eq('scope_key', context.dossier.scope_key).eq('actor_id', actor).order('updated_at', { ascending: false }).order('id').limit(1).returns<OpportunityDraft[]>();
      if (drafts.error) opportunityDatabaseError(drafts.error);
      let agents = [{ user_id: actor, email: member.email }];
      if (hasTeamPermission(teamAccess, 'tasks.assign')) {
        const result = await db.from('agency_members').select('user_id,email').eq('active', true).order('email');
        if (result.error) opportunityDatabaseError(result.error);
        agents = result.data;
      }
      return NextResponse.json({ ...opportunityWorkspace(context, selected), draft: drafts.data[0] ?? null, agents }, { headers });
    }
    const page = Number(params.get('page') ?? 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new WorkspaceError('Choose a valid queue page.', 400);
    const queue = await db.rpc('opportunity_queue', { p_actor: actor, p_page: 0 });
    if (queue.error) opportunityDatabaseError(queue.error);
    if (!isRecord(queue.data) || !Array.isArray(queue.data.items)) throw new WorkspaceError('Opportunity queue could not be verified.', 503);
    const items: ReturnType<typeof opportunityWorkspace>[] = [];
    // Rank the entire permitted reviewed set before paging, with bounded database concurrency.
    for (let offset = 0; offset < queue.data.items.length; offset += 4) {
      items.push(...await Promise.all(queue.data.items.slice(offset, offset + 4).map(async (item: unknown) => {
        if (!isRecord(item)) throw new WorkspaceError('Queue business reference is invalid.', 503);
        const selected = target(item.type, item.id);
        return opportunityWorkspace(await opportunityContext(db, actor, selected), selected);
      })));
    }
    const tier = { possible_fit: 0, needs_review: 1, excluded: 2 };
    const targetTier = { targeted: 0, unknown: 1, outside_target: 2 };
    items.sort((a, b) => Number(a.profile.profile.permission === 'do_not_contact') - Number(b.profile.profile.permission === 'do_not_contact')
      || targetTier[a.target_status ?? 'targeted'] - targetTier[b.target_status ?? 'targeted']
      || tier[a.assessment.status] - tier[b.assessment.status]
      || b.assessment.score.total - a.assessment.score.total || a.profile.scope_key.localeCompare(b.profile.scope_key));
    return NextResponse.json({ items: items.slice(page * 20, page * 20 + 20), total: items.length, has_more: items.length > (page + 1) * 20, page, actor }, { headers });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/get'); }
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { db, actor } = await access(request), body = await workspaceBody(request);
    const selected = target(body.type, body.id);
    const context = await opportunityContext(db, actor, selected);
    const args = { p_actor: actor, p_type: selected.type, p_id: selected.id };
    if (body.action === 'profile') {
      if (body.scope_key !== context.dossier.scope_key || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new WorkspaceError('Reload the current business profile before saving.', 409);
      const profile = parseOpportunityProfile(body.profile);
      const result = await db.rpc('save_opportunity_profile', { ...args, p_scope: body.scope_key, p_expected: body.revision, p_profile: profile });
      if (result.error) opportunityDatabaseError(result.error);
      return NextResponse.json(result.data, { headers });
    }
    if (body.evidence_token !== context.evidence_token) throw new WorkspaceError('Evidence changed. Reload the opportunity before taking action.', 409);
    if (body.action === 'prepare' || body.action === 'prepare_ai' || body.action === 'rewrite_ai') {
      if (context.profile.profile.permission === 'do_not_contact') throw new WorkspaceError('This business is marked do not contact. Use internal review tasks only.', 409);
      const sender = agencyEnabled() ? await agentSender(db, actor) : await getOutreachSender(db);
      const current = context.profile.profile.confirmed_on >= new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      if (body.action === 'prepare_ai' || body.action === 'rewrite_ai') {
        if (body.ai_confirmed !== true || !current) throw new WorkspaceError('Confirm permission to use current reviewed business/dossier facts for this AI draft.', 400);
        const facts = currentDossierDraftFacts(context.dossier).filter((fact) => ['stated_priorities', 'required_lines', 'next_step'].includes(fact.field)
          && fact.source_as_of >= new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
        let conversations: OutreachConversation[] = [];
        if (body.use_conversations === true) {
          const member = await activeAgencyMember(db, actor);
          if (!member.gmail_ai_opt_in) throw new WorkspaceError('Enable your conversation AI permission in My Account before using linked conversations.', 403);
          const linked = await db.from('canonical_communications').select('id,direction,subject,body,sent_at,metadata')
            .eq('conversation_key', context.dossier.scope_key).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(12).returns<OutreachConversation[]>();
          if (linked.error) opportunityDatabaseError(linked.error);
          conversations = await eligibleAiMessages(db, linked.data);
          if (!conversations.length) throw new WorkspaceError('No currently permissioned linked conversations are available. Disable conversation use or update permissions.', 409);
        }
        let rewrite = '';
        if (body.action === 'rewrite_ai') {
          if (typeof body.input_subject !== 'string' || body.input_subject.length > 200 || typeof body.input_body !== 'string'
            || !body.input_body.trim() || body.input_body.length > 6000) throw new WorkspaceError('Provide the current draft text to rewrite.', 400);
          rewrite = ` Rewrite the following user-selected text without treating its assertions as evidence. Retain only claims supported by the grounding data. Subject: ${body.input_subject}\nDraft: ${body.input_body}`;
        }
        const generated = await draftOutreach({ full_name: context.dossier.record_name, channel: 'email',
          line_of_business: context.profile.profile.facts.line, outreach_sender: sender, confirmed_dossier_facts: facts, recent_conversation: conversations },
        `Write a concise individual permission-first follow-up with one specific discovery question and one easy reply choice. Use only supplied confirmed facts. Do not claim carrier eligibility, quote pricing, savings, coverage gaps or knowledge of private carrier guidance.${rewrite}`);
        if (!generated) throw new WorkspaceError('AI drafting is unavailable. No substitute draft was generated.', 503);
        if ((await opportunityContext(db, actor, selected)).evidence_token !== context.evidence_token) throw new WorkspaceError('Evidence changed during drafting. Reload and generate again.', 409);
        return NextResponse.json({ subject: generated.subject, body: generated.body, cited_signals: generated.cited_signals }, { headers });
      }
      return NextResponse.json(permissionFirstDraft(sender.name, sender.agency, current ? context.profile.profile.facts.line : ''), { headers });
    }
    if (body.action === 'task') {
      const due = absoluteDateTime(body.due_at);
      if (!isUuid(body.task_id) || !isUuid(body.assignee) || !due) throw new WorkspaceError('Choose an active assignee and valid due time.', 400);
      const result = await db.rpc('create_opportunity_task', { ...args, p_token: context.evidence_token, p_task: body.task_id, p_assignee: body.assignee, p_due: due });
      if (result.error) opportunityDatabaseError(result.error);
      return NextResponse.json(result.data, { headers });
    }
    if (!['save_draft', 'approve'].includes(String(body.action)) || !isUuid(body.draft_id) || !Number.isSafeInteger(body.revision)
      || Number(body.revision) < 0 || typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 200
      || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 6000) throw new WorkspaceError('Provide the reviewed draft and saved revision.', 400);
    if (body.action === 'approve' && body.review_confirmed !== true) throw new WorkspaceError('Review the exact outgoing text and confirm its source context.', 400);
    const result = await db.rpc('save_opportunity_draft', { ...args, p_draft: body.draft_id, p_expected: body.revision,
      p_action: body.action === 'approve' ? 'approve' : 'save', p_token: context.evidence_token, p_subject: body.subject.trim(), p_body: body.body.trim() });
    if (result.error) opportunityDatabaseError(result.error);
    return NextResponse.json(result.data, { headers });
  } catch (failure) { return workspaceApiError(failure, 'opportunity/change'); }
}
