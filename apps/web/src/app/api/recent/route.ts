import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';

interface RecentRecord {
  id: string;
  type: string;
  name: string;
  touchedAt: string;
  href: string | null;
}

/**
 * Real activity feed for the dashboard: new/updated leads, messages in and
 * out, completed tasks, and newly created clients — newest first.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const [leadsRes, commsRes, tasksRes, clientsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id,full_name,source,created_at,last_activity_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('communication_log')
      .select('id,client_id,direction,subject,channel,sent_at')
      .order('sent_at', { ascending: false })
      .limit(8),
    supabase
      .from('tasks')
      .select('id,subject,status,created_at,due_date,related_type,related_id')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('clients').select('id,full_name,created_at').order('created_at', { ascending: false }).limit(5),
  ]);

  const records: RecentRecord[] = [];

  for (const row of leadsRes.data ?? []) {
    records.push({
      id: `lead-${row.id}`,
      type: 'New Lead',
      name: `${row.full_name}${row.source ? ` — via ${row.source}` : ''}`,
      touchedAt: row.created_at as string,
      href: `/leads?lead=${row.id}`,
    });
    // A later activity timestamp means something happened after creation (e.g. a resubmission).
    const activity = row.last_activity_at as string | null;
    if (activity && new Date(activity).getTime() - new Date(row.created_at as string).getTime() > 60000) {
      records.push({
        id: `lead-activity-${row.id}`,
        type: 'Lead Update',
        name: `${row.full_name} — new activity on this lead`,
        touchedAt: activity,
        href: `/leads?lead=${row.id}`,
      });
    }
  }

  // Resolve client names for messages in one query.
  const clientIds = Array.from(
    new Set((commsRes.data ?? []).map((row) => row.client_id as string | null).filter((id): id is string => Boolean(id))),
  );
  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await supabase.from('clients').select('id,full_name').in('id', clientIds);
    for (const client of clientRows ?? []) clientNames.set(client.id as string, client.full_name as string);
  }

  for (const row of commsRes.data ?? []) {
    const who = row.client_id ? clientNames.get(row.client_id as string) ?? 'Unknown contact' : 'Unknown contact';
    const inbound = row.direction === 'inbound';
    records.push({
      id: `comm-${row.id}`,
      type: inbound ? 'Reply In' : 'Message Sent',
      name: inbound ? `${who} replied${row.subject ? `: ${row.subject}` : ''}` : `To ${who}${row.subject ? `: ${row.subject}` : ''}`,
      touchedAt: row.sent_at as string,
      href: '/communication',
    });
  }

  for (const row of tasksRes.data ?? []) {
    records.push({
      id: `task-${row.id}`,
      type: 'Task Done',
      name: row.subject as string,
      touchedAt: row.created_at as string,
      href:
        row.related_type === 'lead' && row.related_id ? `/leads?lead=${row.related_id}` : '/tasks',
    });
  }

  for (const row of clientsRes.data ?? []) {
    records.push({
      id: `client-${row.id}`,
      type: 'Client',
      name: row.full_name as string,
      touchedAt: row.created_at as string,
      href: `/clients/${row.id}`,
    });
  }

  const merged = records
    .filter((record) => record.touchedAt && !Number.isNaN(new Date(record.touchedAt).getTime()))
    .sort((a, b) => new Date(b.touchedAt).getTime() - new Date(a.touchedAt).getTime())
    .slice(0, 12);

  return NextResponse.json(merged, { status: 200 });
}
