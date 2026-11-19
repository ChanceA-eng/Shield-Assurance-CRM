import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { trackedAutomation } from '../../../../lib/automation-health';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { GET as sync } from '../sync-leads/route';
import { GET as scheduled } from '../../messages/process-scheduled/route';
import { processAgentScheduled } from '../../../../lib/agent-scheduled';
import { processDueEnrollments } from '../../../../lib/outreach-engine';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { runOpportunityJobs } from '../../../../lib/opportunity-jobs';
import { requeueTransientOshaGaps, runBusinessResearchJobs } from '../../../../lib/business-research-jobs';
import { runDirectoryIndexJob } from '../../../../lib/business-research-index';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ message: 'Unauthorized cron request.' }, { status: 401 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: 'Send a JSON heartbeat request.' }, { status: 400 }); }
  if (body && typeof body === 'object' && 'verify_only' in body && body.verify_only === true) {
    return NextResponse.json({ ok: true, verify_only: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const job = body && typeof body === 'object' && 'job' in body ? body.job : null;
  if (typeof job !== 'string' || !['business-research', 'opportunity-intelligence', 'personal-gmail', 'scheduled-messages', 'follow-up-routine', 'outreach', 'renewal-radar', 'website-intake', 'internal-actions', 'custom-workflows'].includes(job)) {
    return NextResponse.json({ message: 'Send a supported heartbeat job.' }, { status: 400 });
  }
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const run = await trackedAutomation(db, `server-heartbeat:${job}`, async () => {
      if (job === 'business-research') {
        const requeued = await requeueTransientOshaGaps(db);
        const [result, directory] = await Promise.all([runBusinessResearchJobs(db), runDirectoryIndexJob(db)]);
        return { status: result.failed || result.partial || directory.failed ? 'partial' : 'succeeded', summary: { ...result, directory, requeued },
          ...(result.failed || result.partial || directory.failed ? { error: 'Some business research could not be completed. Review the source coverage and automation run.' } : {}) };
      }
      if (job === 'opportunity-intelligence') {
        const result = await runOpportunityJobs(db);
        return { status: result.failed ? 'partial' : 'succeeded', summary: result,
          ...(result.failed ? { error: 'An OIP watch needs review. Open Opportunity Intelligence.' } : {}) };
      }
      if (job === 'personal-gmail') {
        const previous = await db.from('automation_runs').select('summary').eq('job', 'server-heartbeat:personal-gmail')
          .in('status', ['succeeded', 'partial']).not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle();
        if (previous.error) throw databaseError(previous.error);
        const summary = isRecord(previous.data?.summary) ? previous.data.summary : null;
        const sequences = summary && isRecord(summary.sequences) ? summary.sequences : null;
        const after = sequences?.next_cursor ?? null;
        if (after !== null && !isUuid(after)) throw new WorkspaceError('Gmail scheduling progress could not be read. Review the last run before retrying.', 409);
        const [schedules, processedSequences] = await Promise.all([
          processAgentScheduled(db, 1),
          processDueEnrollments(db, { limit: 1, after, gmailOnly: true }),
        ]);
        return { status: schedules.blocked > 0 ? 'partial' : 'succeeded',
          summary: { schedules, sequences: processedSequences },
          ...(schedules.blocked > 0 ? { error: 'A Gmail schedule needs review.' } : {}) };
      }
      const headers = { authorization: `Bearer ${secret}` };
      const url = new URL(job === 'scheduled-messages' ? '/api/messages/process-scheduled?limit=1'
        : `/api/cron/sync-leads?job=${encodeURIComponent(job)}&bounded=true`, request.url);
      const response = await (job === 'scheduled-messages' ? scheduled : sync)(new NextRequest(url, { headers }));
      const result: Record<string, unknown> = await response.json();
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : `${job} failed.`);
      const partial = result.ok === false || Number(result.failed) > 0 || Number(result.blocked) > 0;
      return { status: partial ? 'partial' : 'succeeded', summary: result,
        error: partial ? String(result.message ?? `${job} did not finish. Review its result before retrying.`) : undefined };
    });
    return NextResponse.json({ ok: run.status === 'succeeded', run }, { status: run.status === 'succeeded' ? 200 : 207 });
  } catch (error) { return workspaceApiError(error, 'cron/heartbeat'); }
}
