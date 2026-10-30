import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { getOutreachSettings, sentTodayCount } from '../../../lib/outreach-engine';

/** Outreach command center payload: settings, pending approvals, enrollments, counters. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const [settings, sentToday, pendingRes, enrollmentsRes, recentRes, optOutsRes] = await Promise.all([
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
      .in('status', ['sent', 'failed'])
      .order('created_at', { ascending: false })
      .limit(25),
    supabase.from('outreach_opt_outs').select('email', { count: 'exact', head: true }),
  ]);

  const pending = pendingRes.data ?? [];
  const enrollments = enrollmentsRes.data ?? [];
  const recent = recentRes.data ?? [];

  // Resolve lead names in one query.
  const leadIds = Array.from(
    new Set([...pending, ...enrollments, ...recent].map((row) => row.lead_id as string).filter(Boolean)),
  );
  const names = new Map<string, { full_name: string; status: string | null }>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id,full_name,status').in('id', leadIds);
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
}

/** Updates outreach settings. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const payload = (await request.json().catch(() => ({}))) as {
    approval_mode?: boolean;
    daily_send_cap?: number;
    send_window_start?: number;
    send_window_end?: number;
  };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof payload.approval_mode === 'boolean') update.approval_mode = payload.approval_mode;
  if (Number.isInteger(payload.daily_send_cap) && (payload.daily_send_cap as number) > 0) update.daily_send_cap = payload.daily_send_cap;
  if (Number.isInteger(payload.send_window_start)) update.send_window_start = payload.send_window_start;
  if (Number.isInteger(payload.send_window_end)) update.send_window_end = payload.send_window_end;

  const { error } = await supabase.from('outreach_settings').update(update).eq('id', 1);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
