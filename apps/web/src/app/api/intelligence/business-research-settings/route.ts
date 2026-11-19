import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await requireAgencyOwner(db, session.user.id);
    const [settings, sources, jobs, partial, partitions] = await Promise.all([
      db.from('business_research_settings').select('*').eq('id', 1).single(),
      db.from('business_research_sources').select('provider,enabled,retained_rights,reference,revision').order('provider'),
      db.from('business_research_jobs').select('business_id,state,error,attempts,updated_at,coverage:result->coverage').eq('state', 'failed').order('updated_at', { ascending: false }).limit(20),
      db.from('business_research_jobs').select('business_id,state,error,attempts,updated_at,coverage:result->coverage').eq('state', 'complete')
        .contains('result', { coverage: [{ state: 'unavailable' }] }).order('updated_at', { ascending: false }).limit(20),
      db.from('business_research_partitions').select('provider,state,status,cursor,error,updated_at').order('updated_at', { ascending: false }).limit(100),
    ]);
    if (settings.error) throw databaseError(settings.error);
    if (sources.error) throw databaseError(sources.error);
    if (jobs.error) throw databaseError(jobs.error);
    if (partial.error) throw databaseError(partial.error);
    if (partitions.error) throw databaseError(partitions.error);
    return NextResponse.json({ settings: settings.data, sources: sources.data, incomplete_jobs: [...jobs.data, ...partial.data], partitions: partitions.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return workspaceApiError(error, 'intelligence/business-settings'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await requireAgencyOwner(db, session.user.id);
    const body = await workspaceBody(request);
    if (body.action === 'retry_index') {
      if (!['irs', 'dol_5500', 'osm'].includes(String(body.provider)) || typeof body.state !== 'string' || !/^[A-Z]{2}$/.test(body.state)) throw new WorkspaceError('Choose a failed directory index.', 400);
      const saved = await db.rpc('retry_business_research_partition', { p_actor: session.user.id, p_provider: body.provider, p_state: body.state });
      if (saved.error) throw databaseError(saved.error);
      return NextResponse.json({ queued: true });
    }
    if (body.action === 'retry') {
      if (!isUuid(body.business_id)) throw new WorkspaceError('Choose an incomplete research job.', 400);
      const saved = await db.rpc('retry_business_research_job', { p_actor: session.user.id, p_business: body.business_id });
      if (saved.error) throw databaseError(saved.error);
      return NextResponse.json({ queued: true });
    }
    if (!isRecord(body.config) || !Array.isArray(body.sources) || !Number.isInteger(body.expected_revision)
      || typeof body.config.enabled !== 'boolean' || typeof body.config.tasks_enabled !== 'boolean') throw new WorkspaceError('Provide current research settings.', 400);
    for (const [field, maximum] of [['task_capacity', 100], ['task_due_days', 30], ['refresh_days', 365]] as const) {
      const value = body.config[field];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) throw new WorkspaceError(`Enter ${field.replace(/_/g, ' ')} between 1 and ${maximum}.`, 400);
    }
    const saved = await db.rpc('save_business_research_settings', {
      p_actor: session.user.id, p_expected: body.expected_revision, p_config: body.config, p_sources: body.sources,
    });
    if (saved.error) throw databaseError(saved.error);
    return NextResponse.json(saved.data);
  } catch (error) { return workspaceApiError(error, 'intelligence/business-settings-save'); }
}
