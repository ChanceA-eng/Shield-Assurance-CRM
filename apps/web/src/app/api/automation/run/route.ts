import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getAutomationSettings } from '../../../../lib/automation-settings';
import { trackedAutomation } from '../../../../lib/automation-health';
import { runRenewalRadar } from '../../../../lib/renewal-automation';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { databaseError, workspaceBody, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { runWorkflowAutomation } from '../../../../lib/workflow-execution';

const jobs = ['follow-up-routine', 'due-reminders', 'renewal-radar', 'internal-actions', 'outreach', 'custom-workflows'];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const job = request.nextUrl.searchParams.get('job');
    if (!job || !jobs.includes(job)) throw new WorkspaceError('Choose a supported automation job.', 400);
    const result = await db.rpc('preview_automation_job', { p_job: job });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'automation/preview'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    await requireAgencyOwner(db, session.user.id);
    const body = await workspaceBody(request);
    if (typeof body.job !== 'string' || !jobs.includes(body.job) || body.confirmed !== true || typeof body.expected_revision !== 'number'
      || !Number.isInteger(body.expected_revision) || body.expected_revision < 1 || body.expected_revision > 2147483647
      || Object.keys(body).some((key) => !['job', 'confirmed', 'expected_revision', 'expected_workflow_revision'].includes(key))
      || (body.job === 'custom-workflows' && (typeof body.expected_workflow_revision !== 'number'
        || !Number.isSafeInteger(body.expected_workflow_revision) || body.expected_workflow_revision < 0))
      || (body.job !== 'custom-workflows' && body.expected_workflow_revision !== undefined)) {
      throw new WorkspaceError('Preview and confirm one supported automation job before running it.', 400);
    }
    const current = await getAutomationSettings(db);
    if (body.expected_revision !== current.revision) throw new WorkspaceError('Settings changed after the preview. Preview again before running.', 409);
    if (body.job === 'custom-workflows') {
      const revision = await db.rpc('workflow_rule_revision');
      if (revision.error) throw databaseError(revision.error);
      if (typeof revision.data !== 'number' || !Number.isSafeInteger(revision.data) || revision.data < 0) throw new Error('Workflow configuration revision could not be verified.');
      if (revision.data !== body.expected_workflow_revision) throw new WorkspaceError('Custom rules changed after the preview. Preview again before running.', 409);
    }
    const job = body.job;
    const run = await trackedAutomation(db, job, async () => {
      if (job === 'custom-workflows') return runWorkflowAutomation(db, session.user.id);
      if (job === 'renewal-radar') return { status: 'succeeded', summary: await runRenewalRadar(db) };
      if (job === 'outreach') return { status: 'succeeded', summary: await processDueEnrollments(db) };
      const rpc = job === 'follow-up-routine' ? 'ensure_default_followups' : job === 'due-reminders' ? 'dispatch_due_reminders' : 'reconcile_internal_actions';
      const result = await db.rpc(rpc);
      if (result.error) throw databaseError(result.error);
      return { status: 'succeeded', summary: { result: result.data } };
    });
    return NextResponse.json({ ok: run.status === 'succeeded', run }, { status: run.status === 'succeeded' ? 200 : 207 });
  } catch (error) { return workspaceApiError(error, 'automation/run'); }
}
