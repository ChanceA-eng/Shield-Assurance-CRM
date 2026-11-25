import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { ACTIVE_LEAD_STATUSES } from '../../../lib/lead-pipeline';
import { loadHomePremiumMetrics, type DashboardData, type DashboardRenewal } from '../../../lib/home-metrics';
import { hasTeamPermission } from '../../../lib/team-request-access';
import { taskScope } from '../../../lib/task-access';
import { loadTaskTimeliness } from '../../../lib/task-timeliness';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';
import { isRecord } from '../../../lib/workspace-validation';

function isRenewal(value: unknown): value is DashboardRenewal {
  return isRecord(value) && typeof value.id === 'string' && typeof value.insured_name === 'string'
    && typeof value.carrier === 'string' && typeof value.line_of_business === 'string'
    && (value.premium === null || typeof value.premium === 'number' || typeof value.premium === 'string')
    && (value.renewal_date === null || typeof value.renewal_date === 'string')
    && (value.expiration_date === null || typeof value.expiration_date === 'string');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Dashboard data is unavailable.' }, { status: 503 });
  try {
    const access = session.teamAccess;
    const leadScope = hasTeamPermission(access, 'leads.view', 'agency') ? 'agency'
      : hasTeamPermission(access, 'leads.view', 'assigned') ? 'assigned' : null;
    const policyScope = hasTeamPermission(access, 'policies.view', 'agency') && hasTeamPermission(access, 'accounts.view', 'agency')
      ? 'agency' : hasTeamPermission(access, 'policies.view', 'assigned') && hasTeamPermission(access, 'accounts.view', 'assigned')
        ? 'assigned' : null;
    const scope = taskScope(access, 'tasks.view');
    const section = request.nextUrl.searchParams.get('section') ?? 'overview';
    const response = (data: unknown): NextResponse => NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
    if (section === 'tasks') {
      return response({ tasks: scope ? await loadTaskTimeliness(db, new Date(), { actor: session.user.id, scope }) : null });
    }
    if (section === 'renewals') {
      if (!policyScope) return response({ renewals: null });
      const renewalQuery = () => (policyScope === 'assigned'
        ? db.rpc('team_assigned_dashboard_renewals', { p_actor: session.user.id })
        : db.from('renewals')).select('id,insured_name,carrier,line_of_business,premium,renewal_date,expiration_date')
        .eq('renewal_bucket', '0-30');
      const [dated, expiration] = await Promise.all([
        renewalQuery().not('renewal_date', 'is', null).order('renewal_date').limit(8),
        renewalQuery().is('renewal_date', null).order('expiration_date').limit(8),
      ]);
      if (dated.error) throw databaseError(dated.error);
      if (expiration.error) throw databaseError(expiration.error);
      const datedRows: unknown = dated.data, expirationRows: unknown = expiration.data;
      if (!Array.isArray(datedRows) || !datedRows.every(isRenewal)
        || !Array.isArray(expirationRows) || !expirationRows.every(isRenewal)) throw new Error('Renewal records were not returned.');
      return response({ renewals: [...datedRows, ...expirationRows].sort((a, b) =>
        (a.renewal_date ?? a.expiration_date ?? '').localeCompare(b.renewal_date ?? b.expiration_date ?? '')).slice(0, 8) });
    }
    if (section !== 'overview') throw new WorkspaceError('Choose a valid dashboard section.', 400);
    const leads = async (): Promise<DashboardData['leads']> => {
      if (!leadScope) return null;
      const base = () => {
        let query = db.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null);
        if (leadScope === 'assigned') query = query.eq('agent_user_id', session.user.id);
        return query;
      };
      const [active, total, won] = await Promise.all([
        base().in('status', [...ACTIVE_LEAD_STATUSES]), base(), base().eq('status', 'won'),
      ]);
      for (const result of [active, total, won]) if (result.error) throw databaseError(result.error);
      if (active.count === null || total.count === null || won.count === null) throw new Error('Lead counts were not returned.');
      return { active: active.count, conversion: total.count ? won.count / total.count : 0, scope: leadScope };
    };
    const policies = async (): Promise<DashboardData['policies']> => {
      if (!policyScope) return null;
      const [premium, count, claims] = await Promise.all([
        loadHomePremiumMetrics(db, new Date(), policyScope === 'assigned' ? session.user.id : undefined),
        (policyScope === 'assigned' ? db.rpc('team_assigned_dashboard_renewals', { p_actor: session.user.id }, { count: 'exact', head: true }).select('id')
          : db.from('renewals').select('id', { count: 'exact', head: true })).eq('renewal_bucket', '0-30'),
        (policyScope === 'assigned' ? db.rpc('team_assigned_dashboard_claims', { p_actor: session.user.id }, { count: 'exact', head: true }).select('id')
          : db.from('claims').select('id', { count: 'exact', head: true })).eq('status', 'open'),
      ]);
      for (const result of [count, claims]) if (result.error) throw databaseError(result.error);
      if (count.count === null || claims.count === null) throw new Error('Policy counts were not returned.');
      return { ...premium, scope: policyScope, renewals_30_days: count.count, open_claims: claims.count };
    };
    const [leadData, policyData] = await Promise.all([leads(), policies()]);
    return response({ leads: leadData, policies: policyData } satisfies DashboardData);
  } catch (error) {
    return workspaceApiError(error, 'dashboard');
  }
}
