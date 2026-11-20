import { NextRequest, NextResponse } from 'next/server';
import { AUTOMATION_EXECUTION_POLICY, AUTOMATION_RULE_INVENTORY, validateAutomationConfiguration } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getAutomationSettings, parseAutomationSnapshot } from '../../../../lib/automation-settings';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { requireTeamPermission } from '../../../../lib/team-request-access';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'automation.view');
    const rawBefore = request.nextUrl.searchParams.get('before');
    const before = rawBefore === null ? null : Number(rawBefore);
    if (before !== null && (!/^[1-9]\d*$/.test(rawBefore ?? '') || !Number.isSafeInteger(before) || before > 2147483647)) {
      throw new WorkspaceError('Choose a valid settings history revision.', 400);
    }

    const current = await getAutomationSettings(db);
    let history = db.from('automation_configuration_versions').select('revision,actor_id,recorded_at,configuration')
      .lte('revision', current.revision).order('revision', { ascending: false }).limit(20);
    if (before !== null) history = history.lt('revision', before);
    const { data, error } = await history;
    if (error) throw databaseError(error);
    const versions = (data ?? []).map((row) => ({ ...row, configuration: parseAutomationSnapshot(row.configuration) }));
    return NextResponse.json({
      ...current, inventory: AUTOMATION_RULE_INVENTORY, execution_policy: AUTOMATION_EXECUTION_POLICY,
      history: versions, next_before: versions.length === 20 ? versions[versions.length - 1].revision : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'settings/automation'); }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'automation.manage');
    const body = await workspaceBody(request);
    if (Object.keys(body).some((key) => !['configuration', 'expected_revision'].includes(key))
      || typeof body.expected_revision !== 'number' || !Number.isInteger(body.expected_revision)
      || body.expected_revision < 1 || body.expected_revision > 2147483647) throw new WorkspaceError('Choose a valid settings revision and configuration.', 400);
    let configuration;
    try { configuration = validateAutomationConfiguration(body.configuration); }
    catch (failure) { throw new WorkspaceError(failure instanceof Error ? failure.message : 'Choose valid automation settings.', 400); }
    const saved = await db.rpc('save_agency_automation_settings', {
      p_actor: session.user.id, p_configuration: configuration, p_expected_revision: body.expected_revision,
    });
    if (saved.error) throw databaseError(saved.error);
    if (typeof saved.data !== 'number' || !Number.isInteger(saved.data) || saved.data < body.expected_revision) throw new Error('The saved automation revision could not be verified.');
    return NextResponse.json({ revision: saved.data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'settings/automation'); }
}
