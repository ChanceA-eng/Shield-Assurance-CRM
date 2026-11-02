import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { getOutreachSettings, sentTodayCount } from '../../../lib/outreach-engine';
import { isUuid } from '../../../lib/workspace-validation';
import { parseOutreachSender } from '../../../lib/marketing-profile';
import { workspaceApiError, workspaceBody } from '../../../lib/workspace-api';

/** Outreach command center payload: settings, pending approvals, enrollments, counters. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const statuses = ['sent', 'failed', 'sending', 'acceptance_unknown', 'accepted_by_provider'];
  const filter = request.nextUrl.searchParams.get('recent_status') ?? 'all';
  const attempt = request.nextUrl.searchParams.get('attempt');
  if (attempt !== null && !isUuid(attempt)) return NextResponse.json({ message: 'Choose a valid outreach attempt.' }, { status: 400 });
  if (filter !== 'all' && !statuses.includes(filter)) {
    return NextResponse.json({ message: 'Unknown outreach activity status.' }, { status: 400 });
  }
  try {
  const [settings, sentToday, pendingRes, enrollmentsRes, recentRes, optOutsRes, selectedRes] = await Promise.all([
    getOutreachSettings(supabase),
    sentTodayCount(supabase),
    supabase
      .from('outreach_outbox')
      .select('*')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true })
      .limit(100),
    supabase
      .from('sequence_enrollments')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('next_send_at', { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from('outreach_outbox')
      .select('id,lead_id,step_number,subject,status,sent_at,error,created_at')
      .in('status', filter === 'all' ? statuses : [filter])
      .order('created_at', { ascending: false })
      .limit(25),
    supabase.from('outreach_opt_outs').select('email', { count: 'exact', head: true }),
    attempt ? supabase.from('outreach_outbox').select('*').eq('id', attempt).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [pendingRes, enrollmentsRes, recentRes, optOutsRes, selectedRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const pending = pendingRes.data ?? [];
  const enrollments = enrollmentsRes.data ?? [];
  const recent = recentRes.data ?? [];
  if (attempt && !selectedRes.data) return NextResponse.json({ message: 'This outreach attempt no longer exists.' }, { status: 404 });
  if (selectedRes.data?.status === 'pending_approval' && !pending.some((row) => row.id === attempt)) pending.unshift(selectedRes.data);
  if (selectedRes.data && selectedRes.data.status !== 'pending_approval' && !recent.some((row) => row.id === attempt)) recent.unshift(selectedRes.data);

  // Resolve lead names in one query.
  const leadIds = Array.from(
    new Set([...pending, ...enrollments, ...recent].map((row) => row.lead_id as string).filter(Boolean)),
  );
  const names = new Map<string, { full_name: string; status: string | null }>();
  if (leadIds.length > 0) {
    const { data: leads, error } = await supabase.from('leads').select('id,full_name,status').in('id', leadIds);
    if (error) throw new Error(error.message);
    for (const lead of leads ?? []) names.set(lead.id as string, { full_name: lead.full_name, status: lead.status });
  }
  const withLead = <T extends { lead_id: string }>(rows: T[]): Array<T & { lead_name: string; lead_status: string | null }> =>
    rows.map((row) => ({
      ...row,
      lead_name: names.get(row.lead_id)?.full_name ?? 'Unknown lead',
      lead_status: names.get(row.lead_id)?.status ?? null,
    }));

  return NextResponse.json(
    {
      settings,
      sent_today: sentToday,
      pending: withLead(pending as Array<{ lead_id: string }>),
      enrollments: withLead(enrollments as Array<{ lead_id: string }>),
      recent: withLead(recent as Array<{ lead_id: string }>),
      opt_outs: optOutsRes.count ?? 0,
    },
    { status: 200 },
  );
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Outreach data could not be loaded.' }, { status: 500 });
  }
}

/** Updates outreach settings. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  try {
  const payload = await workspaceBody(request);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof payload.approval_mode === 'boolean') update.approval_mode = payload.approval_mode;
  for (const [field, min, max] of [['daily_send_cap', 1, 200], ['send_window_start', 0, 23], ['send_window_end', 1, 24]] as const) {
    if (payload[field] !== undefined) {
      const value = payload[field];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        return NextResponse.json({ message: `${field} must be an integer between ${min} and ${max}.` }, { status: 400 });
      }
      update[field] = value;
    }
  }
  const current = await getOutreachSettings(supabase);
  if (Number(update.send_window_start ?? current.send_window_start) >= Number(update.send_window_end ?? current.send_window_end)) {
    return NextResponse.json({ message: 'Send window end must be after its start.' }, { status: 400 });
  }
  if (payload.sender_profile !== undefined) update.sender_profile = parseOutreachSender(payload.sender_profile);

  const { data, error } = await supabase.from('outreach_settings').update(update).eq('id', 1).select('id').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ message: 'Outreach settings were not saved.' }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'outreach/settings');
  }
}
