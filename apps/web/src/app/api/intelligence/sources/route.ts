import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { validEvidenceDate } from '@crm/shared';
import { isRecord } from '../../../../lib/workspace-validation';
import { fmcsaConfigured, oshaConfigured } from '../../../../lib/enrichment';
import { hasTeamPermission, requireTeamPermission } from '../../../../lib/team-request-access';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const can_manage = hasTeamPermission(session.teamAccess, 'automation.manage');
    const result = await db.from('discovery_sources').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw databaseError(result.error);
    return NextResponse.json({ sources: result.data ?? [], can_manage, public_search: { fmcsa_configured: fmcsaConfigured(), osha_configured: oshaConfigured() }, provider_spend_enabled: false });
  } catch (error) { return workspaceApiError(error, 'discovery/sources'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    requireTeamPermission(session.teamAccess, 'automation.manage');
    const body = await workspaceBody(request);
    if (!isRecord(body.config)) throw new WorkspaceError('Provide source approval settings.', 400);
    if (body.config.provider !== undefined && !['file', 'fmcsa'].includes(String(body.config.provider))) {
      throw new WorkspaceError('Choose a supported source provider.', 400);
    }
    if (body.id !== undefined && (!isUuid(body.id) || typeof body.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_updated_at)))) {
      throw new WorkspaceError('Refresh source approvals before saving.', 400);
    }
    if (body.id === undefined && (typeof body.config.name !== 'string' || !body.config.name.trim() || body.config.name.trim().length > 120
      || typeof body.config.permission_reference !== 'string' || !body.config.permission_reference.trim() || body.config.permission_reference.trim().length > 1000
      || !validEvidenceDate(body.config.acquisition_until) || body.config.retained_crm_rights !== true)) {
      throw new WorkspaceError('Provide a source name, documented retained-use rights and a valid acquisition end date.', 400);
    }
    const result = await db.rpc('save_discovery_source', { p_actor: session.user.id, p_id: body.id ?? null,
      p_expected: body.expected_updated_at ?? null, p_config: body.config });
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data);
  } catch (error) { return workspaceApiError(error, 'discovery/source-save'); }
}
