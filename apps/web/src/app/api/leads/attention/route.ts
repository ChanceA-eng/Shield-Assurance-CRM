import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getApiSession } from '../../../../lib/api-auth';
import { isUuid } from '../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { loadAccountLifecycles } from '../../../../lib/account-lifecycle';
import { websiteBusinessDetails } from '../../../../lib/website-intake';

interface IntakeRow {
  id: string;
  lead_id: string;
  submitted_at: string;
  received_at: string;
  time_basis: 'submitted' | 'received';
  snapshot: Record<string, unknown>;
  leads: { full_name: string; line_of_business: string | null; account_id: string | null; industry: string | null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const rows: IntakeRow[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.from('lead_intake_events')
        .select('id,lead_id,submitted_at,received_at,time_basis,snapshot,leads!inner(full_name,line_of_business,account_id,industry)')
        .is('opened_at', null).is('dismissed_at', null).is('handled_at', null)
        .order('submitted_at', { ascending: false }).order('received_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 99).returns<IntakeRow[]>();
      if (error) throw databaseError(error);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 100) break;
    }
    const accountIds = [...new Set(rows.flatMap((row) => row.leads.account_id ? [row.leads.account_id] : []))];
    const lifecycles = await loadAccountLifecycles(supabase, accountIds);
    return NextResponse.json({
      leads: rows.map((row) => {
        const business = websiteBusinessDetails(row.snapshot);
        const lifecycle = row.leads.account_id ? lifecycles.get(row.leads.account_id) : 'Prospect';
        return {
          intake_id: row.id, id: row.lead_id, full_name: row.leads.full_name,
          line_of_business: row.leads.line_of_business, business_name: business.businessName,
          industry: business.industry ?? row.leads.industry, arrived_at: row.submitted_at, time_basis: row.time_basis,
          request_kind: lifecycle && lifecycle !== 'Prospect' ? 'Client request' : 'Website request',
        };
      }),
      total: rows.length,
    });
  } catch (error) {
    return workspaceApiError(error, 'lead-attention/get');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    const ids: unknown = body.ids ?? (body.id ? [body.id] : null);
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) throw new WorkspaceError('Valid submission ids are required.', 400);
    if (body.action !== 'opened' && body.action !== 'dismissed' && body.action !== 'handled') throw new WorkspaceError('Invalid intake action.', 400);
    const { data, error } = await supabase.rpc('acknowledge_intake_events', {
      p_ids: [...new Set(ids)], p_action: body.action, p_actor: session.user.id,
    });
    if (error) throw databaseError(error);
    if (data !== new Set(ids).size) throw new WorkspaceError('The queue did not confirm the acknowledgment. Refresh before retrying.', 500);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workspaceApiError(error, 'lead-attention/patch');
  }
}
