import { NextRequest, NextResponse } from 'next/server';
import { CRM_WORKFLOW_EVENTS, parseWorkflowRule, validateWorkflowDefinition } from '@crm/shared';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { isUuid } from '../../../../../lib/workspace-validation';
import { requireTeamPermission } from '../../../../../lib/team-request-access';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'automation.view');
    const rawPage = request.nextUrl.searchParams.get('page') ?? '0';
    if (!/^\d{1,6}$/.test(rawPage)) throw new WorkspaceError('Choose a valid rule page.', 400);
    const page = Number(rawPage);
    const selected = request.nextUrl.searchParams.get('rule');
    if (selected !== null && !isUuid(selected)) throw new WorkspaceError('Choose a valid workflow rule.', 400);
    const search = (request.nextUrl.searchParams.get('q') ?? '').trim();
    const event = request.nextUrl.searchParams.get('event');
    const active = request.nextUrl.searchParams.get('active');
    if (search.length > 100 || (event !== null && !CRM_WORKFLOW_EVENTS.some((value) => value === event))
      || (active !== null && !['true', 'false'].includes(active))) throw new WorkspaceError('Choose valid rule filters.', 400);
    let query = db.from('workflow_rules').select('id,revision,definition,updated_at', { count: 'exact' });
    if (search) query = query.ilike('definition->>name', `%${search}%`);
    if (event) query = query.eq('trigger_type', event);
    if (active) query = query.eq('active', active === 'true');
    const rules = await query.order('created_at').order('id').range(page * 25, page * 25 + 24);
    if (rules.error) throw databaseError(rules.error);
    if (rules.count === null) throw new Error('Workflow rule count could not be verified.');
    const members: Array<{ user_id: string; email: string; role: string }> = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await db.from('agency_members').select('user_id,email,role').eq('active', true).order('user_id').range(offset, offset + 99);
      if (batch.error) throw databaseError(batch.error);
      members.push(...batch.data);
      if (batch.data.length < 100) break;
    }
    const executions = await db.from('workflow_executions').select('id,rule_id,rule_revision,status,finished_at,error')
      .order('claimed_at', { ascending: false, nullsFirst: false }).limit(20);
    if (executions.error) throw databaseError(executions.error);
    let versions: unknown[] = [];
    let selectedRule = null;
    if (selected) {
      const current = await db.from('workflow_rules').select('id,revision,definition,updated_at').eq('id', selected).maybeSingle();
      if (current.error) throw databaseError(current.error);
      if (!current.data) throw new WorkspaceError('This workflow rule could not be found.', 404);
      selectedRule = parseWorkflowRule(current.data);
      const history = await db.from('workflow_rule_versions').select('revision,definition,recorded_at').eq('rule_id', selected)
        .order('revision', { ascending: false }).limit(20);
      if (history.error) throw databaseError(history.error);
      versions = history.data;
    }
    return NextResponse.json({ items: rules.data.map(parseWorkflowRule), selected_rule: selectedRule,
      total: rules.count, page, page_size: 25, members, executions: executions.data, history: versions, coexistence: 'built-in-priority' },
    { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'settings/workflow-rules'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'automation.manage');
    const body = await workspaceBody(request);
    if (Object.keys(body).some((key) => !['rule_id', 'expected_revision', 'definition'].includes(key))
      || (body.rule_id !== null && !isUuid(body.rule_id)) || typeof body.expected_revision !== 'number'
      || !Number.isInteger(body.expected_revision) || body.expected_revision < 0 || body.expected_revision > 2147483647) {
      throw new WorkspaceError('Choose a valid rule and revision.', 400);
    }
    let definition;
    try { definition = validateWorkflowDefinition(body.definition); }
    catch (failure) { throw new WorkspaceError(failure instanceof Error ? failure.message : 'Choose valid workflow settings.', 400); }
    const saved = await db.rpc('save_workflow_rule', { p_actor: session.user.id, p_rule: body.rule_id,
      p_expected_revision: body.expected_revision, p_definition: definition });
    if (saved.error) throw databaseError(saved.error);
    return NextResponse.json(parseWorkflowRule(saved.data), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'settings/workflow-rules'); }
}
