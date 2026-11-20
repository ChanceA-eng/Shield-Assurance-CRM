import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { activateInstantlyCampaign, InstantlyApiError, pauseInstantlyCampaign } from '../../../../../lib/instantly';
import { assertSameOriginJson, databaseError, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { requireTeamPermission } from '../../../../../lib/team-request-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CampaignState {
  id: string;
  status: string;
  provider_campaign_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    assertSameOriginJson(request);
    requireTeamPermission(session.teamAccess, 'campaigns.send');
    const body = await workspaceBody(request);
    const actionValue = isRecord(body) ? body.action : null;
    if (actionValue !== 'activate' && actionValue !== 'pause') {
      throw new WorkspaceError('Choose whether to activate or pause this campaign.', 400);
    }
    const action = actionValue;
    const { id } = await context.params;
    const { data: campaign, error: campaignError } = await db.from('instantly_campaigns')
      .select('id,status,provider_campaign_id').eq('id', id).maybeSingle<CampaignState>();
    if (campaignError) throw databaseError(campaignError);
    if (!campaign?.provider_campaign_id) throw new WorkspaceError('The provider campaign is not ready for activation.', 409);

    const allowedStatuses = action === 'activate' ? ['ready', 'paused'] : ['active'];
    const expectedStatus = campaign.status;
    const pendingStatus = action === 'activate' ? 'starting' : 'pausing';
    const uncertainStatus = action === 'activate' ? 'activation_unknown' : 'pause_unknown';
    if (!allowedStatuses.includes(expectedStatus)) {
      throw new WorkspaceError(`Only a ${action === 'activate' ? 'ready or paused' : 'active'} campaign can be ${action === 'activate' ? 'activated' : 'paused'}. Current status: ${campaign.status}.`, 409);
    }

    const { data: claimed, error: claimError } = await db.from('instantly_campaigns')
      .update({ status: pendingStatus, last_error: null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', expectedStatus).select('id').maybeSingle<{ id: string }>();
    if (claimError) throw databaseError(claimError);
    if (!claimed) throw new WorkspaceError('Another campaign operation is already in progress. Refresh the campaign status.', 409);

    try {
      if (action === 'activate') await activateInstantlyCampaign(campaign.provider_campaign_id);
      else await pauseInstantlyCampaign(campaign.provider_campaign_id);
    } catch (error) {
      const providerStatus = error instanceof InstantlyApiError ? error.status : null;
      const unknown = providerStatus === null || (providerStatus >= 200 && providerStatus < 300);
      const { error: updateError } = await db.from('instantly_campaigns').update({
        status: unknown ? uncertainStatus : expectedStatus,
        last_error: error instanceof Error ? error.message : 'Instantly did not confirm the campaign operation.',
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', pendingStatus);
      if (updateError) throw databaseError(updateError);
      throw error;
    }

    const { error: updateError } = await db.from('instantly_campaigns').update({
      status: action === 'activate' ? 'active' : 'paused',
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('status', pendingStatus);
    if (updateError) {
      const { error: stateError } = await db.from('instantly_campaigns').update({
        status: uncertainStatus,
        last_error: 'Instantly accepted the operation, but the CRM could not record the result. Check Instantly before trying again.',
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (stateError) console.error('[instantly/campaign-operation-state]', stateError);
      throw databaseError(updateError);
    }
    return NextResponse.json({ campaign: { id, status: action === 'activate' ? 'active' : 'paused' } });
  } catch (error) { return workspaceApiError(error, 'instantly/campaign-operation'); }
}
