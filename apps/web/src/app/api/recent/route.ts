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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  const [leads, messages, activity, clients, intake] = await Promise.all([
    supabase.from('leads').select('id,full_name,created_at').order('created_at', { ascending: false }).limit(8),
    supabase.from('communication_log').select('id,client_id,direction,subject,sent_at').order('sent_at', { ascending: false }).limit(8),
    supabase.from('client_activities').select('id,client_id,lead_id,activity_type,title,occurred_at').order('occurred_at', { ascending: false }).limit(12),
    supabase.from('clients').select('id,full_name,created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('lead_intake_events').select('id,lead_id,received_at').order('received_at', { ascending: false }).limit(8),
  ]);
  for (const response of [leads, messages, activity, clients, intake]) {
    if (response.error) return NextResponse.json({ message: response.error.message }, { status: 500 });
  }
  const clientIds = [...new Set([
    ...(messages.data ?? []).flatMap((row) => row.client_id ? [row.client_id as string] : []),
    ...(activity.data ?? []).flatMap((row) => row.client_id ? [row.client_id as string] : []),
  ])];
  const leadIds = [...new Set([
    ...(activity.data ?? []).flatMap((row) => row.lead_id ? [row.lead_id as string] : []),
    ...(intake.data ?? []).map((row) => row.lead_id as string),
  ])];
  const [clientNamesRes, leadNamesRes] = await Promise.all([
    clientIds.length ? supabase.from('clients').select('id,full_name').in('id', clientIds) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? supabase.from('leads').select('id,full_name').in('id', leadIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [clientNamesRes, leadNamesRes]) {
    if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  }
  const clientNames = new Map((clientNamesRes.data ?? []).map((row) => [row.id, row.full_name]));
  const leadNames = new Map((leadNamesRes.data ?? []).map((row) => [row.id, row.full_name]));
  const records: RecentRecord[] = (leads.data ?? []).map((lead) => ({
    id: `lead-${lead.id}`, type: 'New Lead', name: lead.full_name,
    touchedAt: lead.created_at, href: `/leads?lead=${lead.id}`,
  }));
  for (const message of messages.data ?? []) {
    const name = clientNames.get(message.client_id) ?? 'Unlinked conversation';
    records.push({
      id: `message-${message.id}`, type: message.direction === 'inbound' ? 'Reply In' : 'Message Sent',
      name: `${name}${message.subject ? `: ${message.subject}` : ''}`, touchedAt: message.sent_at,
      href: message.client_id ? `/clients/${message.client_id}` : '/communication',
    });
  }
  const labels: Record<string, string> = {
    note_added: 'Note', note_updated: 'Note', asset_added: 'Asset', asset_updated: 'Asset',
    asset_archived: 'Asset', asset_restored: 'Asset', task_created: 'Task',
    task_completed: 'Task Done', task_reopened: 'Task', task_rescheduled: 'Task',
  };
  for (const item of activity.data ?? []) {
    const name = item.lead_id ? leadNames.get(item.lead_id) : item.client_id ? clientNames.get(item.client_id) : null;
    records.push({
      id: `activity-${item.id}`, type: labels[item.activity_type] ?? 'Activity',
      name: `${item.title}${name ? ` - ${name}` : ''}`, touchedAt: item.occurred_at,
      href: item.lead_id ? `/leads?lead=${item.lead_id}` : item.client_id ? `/clients/${item.client_id}?tab=tasks` : '/tasks',
    });
  }
  for (const event of intake.data ?? []) {
    records.push({
      id: `intake-${event.id}`, type: 'Website Request', name: leadNames.get(event.lead_id) ?? 'Website request',
      touchedAt: event.received_at, href: `/leads?lead=${event.lead_id}`,
    });
  }
  for (const client of clients.data ?? []) {
    records.push({ id: `account-${client.id}`, type: 'Account', name: client.full_name, touchedAt: client.created_at, href: `/clients/${client.id}` });
  }
  return NextResponse.json(records
    .filter((record) => Number.isFinite(new Date(record.touchedAt).getTime()))
    .sort((left, right) => new Date(right.touchedAt).getTime() - new Date(left.touchedAt).getTime())
    .slice(0, 12));
}
