import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { researchProfile, researchReadiness, refreshResearchMarketFit } from '../../../../lib/business-research-server';
import type { BusinessResearchProfile } from '@crm/shared';
import { after } from 'next/server';
import { requeueOutdatedBusinessResearch, requeueTransientOsha, runBusinessResearchJobs } from '../../../../lib/business-research-jobs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const business = request.nextUrl.searchParams.get('id'), targetId = request.nextUrl.searchParams.get('target_id');
    if (business && isUuid(business)) {
      const profile = await researchProfile(db, session.user.id, business);
      await refreshResearchMarketFit(db, profile);
      const outdated = profile.job?.state === 'complete' && !profile.job.paused
        && await requeueOutdatedBusinessResearch(db, business, profile.job.result);
      const transientOsha = profile.job?.state === 'complete' && !profile.job.paused
        && await requeueTransientOsha(db, business, profile.job.result);
      if (profile.job && (outdated || transientOsha)) {
        profile.job = { ...profile.job, state: 'pending' };
      }
      if (!profile.job?.paused && profile.job?.state === 'pending') after(async () => { await runBusinessResearchJobs(db, business); });
      return NextResponse.json({ ...profile, readiness: await researchReadiness(db) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const type = request.nextUrl.searchParams.get('target_type');
    if (!isUuid(targetId) || !['lead', 'client'].includes(type ?? '')) throw new WorkspaceError('Choose a business or CRM record.', 400);
    const profile = await db.rpc('get_record_business_research', { p_actor: session.user.id, p_type: type, p_id: targetId }).single<BusinessResearchProfile>();
    if (profile.error) throw databaseError(profile.error);
    if (!profile.data) throw new WorkspaceError('Business research could not be loaded.', 503);
    await refreshResearchMarketFit(db, profile.data);
    const businessId = profile.data.business?.id;
    if (businessId && profile.data.job?.state === 'complete' && !profile.data.job.paused
      && await requeueOutdatedBusinessResearch(db, businessId, profile.data.job.result)) {
      profile.data.job = { ...profile.data.job, state: 'pending' };
      after(async () => { await runBusinessResearchJobs(db, businessId); });
    }
    return NextResponse.json({ ...profile.data, readiness: await researchReadiness(db) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return workspaceApiError(error, 'intelligence/business-research'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const body = await workspaceBody(request);
    if (!isUuid(body.business_id)) throw new WorkspaceError('Choose a researched business.', 400);
    const saved = await db.rpc('save_research_business', { p_actor: session.user.id, p_business: body.business_id });
    if (saved.error) throw databaseError(saved.error);
    const businessId = body.business_id;
    after(async () => { await runBusinessResearchJobs(db, businessId); });
    return NextResponse.json(saved.data);
  } catch (error) { return workspaceApiError(error, 'intelligence/business-save'); }
}
