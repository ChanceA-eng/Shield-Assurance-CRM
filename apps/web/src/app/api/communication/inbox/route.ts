import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

interface LogRow {
  id: string;
  client_id: string | null;
  channel: string | null;
  direction: string | null;
  subject: string | null;
  body: string | null;
  automation_type: string | null;
  sent_at: string | null;
  read_at: string | null;
}

export interface Conversation {
  client_id: string;
  name: string;
  email: string | null;
  lead_id: string | null;
  last_subject: string | null;
  last_snippet: string;
  last_direction: string;
  last_at: string | null;
  unread: number;
  total: number;
}

/**
 * Unified inbox: every conversation in one list, grouped by client, newest
 * first, with unread counts and a link back to the matching lead.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { data: rows, error } = await supabase
    .from('communication_log')
    .select('id,client_id,channel,direction,subject,body,automation_type,sent_at,read_at')
    .order('sent_at', { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const byClient = new Map<string, LogRow[]>();
  for (const row of (rows ?? []) as LogRow[]) {
    if (!row.client_id) continue;
    const bucket = byClient.get(row.client_id);
    if (bucket) bucket.push(row);
    else byClient.set(row.client_id, [row]);
  }

  const clientIds = [...byClient.keys()];
  const clients = new Map<string, { full_name: string; email: string | null }>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await supabase.from('clients').select('id,full_name,email').in('id', clientIds);
    for (const client of clientRows ?? []) {
      clients.set(client.id as string, { full_name: client.full_name as string, email: (client.email as string | null) ?? null });
    }
  }

  // Map conversations back to leads by email so the UI can jump to the pipeline profile.
  const emails = [...clients.values()].map((client) => client.email).filter((email): email is string => Boolean(email));
  const leadByEmail = new Map<string, string>();
  if (emails.length > 0) {
    const { data: leadRows } = await supabase.from('leads').select('id,email').in('email', emails).limit(1000);
    for (const lead of leadRows ?? []) {
      const email = ((lead.email as string | null) ?? '').toLowerCase();
      if (email && !leadByEmail.has(email)) leadByEmail.set(email, lead.id as string);
    }
  }

  const conversations: Conversation[] = [];
  for (const [clientId, logRows] of byClient) {
    const client = clients.get(clientId);
    const latest = logRows[0];
    const email = client?.email?.toLowerCase() ?? null;
    conversations.push({
      client_id: clientId,
      name: client?.full_name ?? 'Unknown contact',
      email: client?.email ?? null,
      lead_id: email ? leadByEmail.get(email) ?? null : null,
      last_subject: latest.subject,
      last_snippet: (latest.body ?? '').replace(/\s+/g, ' ').slice(0, 120),
      last_direction: latest.direction ?? 'outbound',
      last_at: latest.sent_at,
      unread: logRows.filter((row) => row.direction === 'inbound' && !row.read_at).length,
      total: logRows.length,
    });
  }

  conversations.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));

  return NextResponse.json({ conversations }, { status: 200 });
}
