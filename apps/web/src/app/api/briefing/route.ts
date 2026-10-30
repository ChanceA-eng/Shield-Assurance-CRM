import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { startOfArizonaDay } from '../../../lib/arizona-time';
import { summarizeBriefing } from '../../../lib/outreach-ai';

interface BriefingTask {
  id: string;
  subject: string;
  due_date: string | null;
  priority: string | null;
  related_type: string | null;
  related_id: string | null;
}

/**
 * Daily agent briefing: everything the producer should act on today, computed
 * from live data, with a short AI priority summary when available.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const now = new Date();
  const dayStart = startOfArizonaDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const [
    overdueRes,
    todayRes,
    unreadRes,
    pendingRes,
    newLeadsRes,
    repliesRes,
    stalledRes,
    activeSeqRes,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select('id,subject,due_date,priority,related_type,related_id')
      .eq('status', 'open')
      .lt('due_date', dayStart.toISOString())
      .order('due_date', { ascending: true })
      .limit(5),
    supabase
      .from('tasks')
      .select('id,subject,due_date,priority,related_type,related_id')
      .eq('status', 'open')
      .gte('due_date', dayStart.toISOString())
      .lt('due_date', dayEnd.toISOString())
      .order('due_date', { ascending: true })
      .limit(8),
    supabase
      .from('communication_log')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .is('read_at', null),
    supabase.from('outreach_outbox').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', yesterday.toISOString()),
    supabase
      .from('sequence_enrollments')
      .select('lead_id')
      .eq('status', 'replied')
      .gte('ended_at', twoDaysAgo.toISOString())
      .limit(10),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'contacted')
      .lt('stage_changed_at', weekAgo.toISOString()),
    supabase.from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  // Count overdue precisely (list above is capped at 5).
  const overdueCountRes = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .lt('due_date', dayStart.toISOString());

  // Resolve reply lead names.
  let replyNames: string[] = [];
  const replyLeadIds = (repliesRes.data ?? []).map((row) => row.lead_id as string);
  if (replyLeadIds.length > 0) {
    const { data: replyLeads } = await supabase.from('leads').select('full_name').in('id', replyLeadIds);
    replyNames = (replyLeads ?? []).map((lead) => lead.full_name as string);
  }

  const briefing = {
    date: now.toISOString(),
    overdue_tasks: overdueCountRes.count ?? 0,
    overdue_sample: (overdueRes.data ?? []) as BriefingTask[],
    today_tasks: (todayRes.data ?? []) as BriefingTask[],
    unread_messages: unreadRes.count ?? 0,
    pending_approvals: pendingRes.count ?? 0,
    new_leads_24h: newLeadsRes.count ?? 0,
    recent_replies: replyNames,
    stalled_leads: stalledRes.count ?? 0,
    active_sequences: activeSeqRes.count ?? 0,
  };

  const facts = [
    `Overdue tasks: ${briefing.overdue_tasks}`,
    `Tasks due today: ${briefing.today_tasks.length}${briefing.today_tasks.length > 0 ? ` (first: ${briefing.today_tasks[0].subject})` : ''}`,
    `Unread inbound messages: ${briefing.unread_messages}`,
    `Outreach drafts awaiting approval: ${briefing.pending_approvals}`,
    `New leads in the last 24h: ${briefing.new_leads_24h}`,
    briefing.recent_replies.length > 0 ? `Prospects who replied to sequences in the last 48h: ${briefing.recent_replies.join(', ')}` : null,
    `Leads stalled in "contacted" for 7+ days: ${briefing.stalled_leads}`,
    `Email sequences currently running: ${briefing.active_sequences}`,
  ]
    .filter(Boolean)
    .join('\n');

  const withSummary = request.nextUrl.searchParams.get('summary') !== '0';
  const summary = withSummary ? await summarizeBriefing(facts) : null;

  return NextResponse.json({ ...briefing, summary }, { status: 200 });
}
