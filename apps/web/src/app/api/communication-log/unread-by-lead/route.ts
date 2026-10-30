import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

function digits(value: string | null): string {
  return (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

/**
 * Unread inbound message counts mapped to leads (via their matched client's
 * email/phone). Powers the "N new" badges on pipeline cards.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const unreadRes = await supabase
    .from('communication_log')
    .select('client_id')
    .eq('direction', 'inbound')
    .is('read_at', null)
    .not('client_id', 'is', null)
    .limit(1000);

  if (unreadRes.error) {
    return NextResponse.json({ message: unreadRes.error.message }, { status: 500 });
  }

  const countsByClient = new Map<string, number>();
  for (const row of unreadRes.data ?? []) {
    const clientId = (row as { client_id: string }).client_id;
    countsByClient.set(clientId, (countsByClient.get(clientId) ?? 0) + 1);
  }

  if (countsByClient.size === 0) {
    return NextResponse.json({}, { status: 200 });
  }

  const [clientsRes, leadsRes] = await Promise.all([
    supabase.from('clients').select('id,email,phone').in('id', [...countsByClient.keys()]),
    supabase.from('leads').select('id,email,phone').in('status', ['new', 'contacted', 'quoted']).limit(1000),
  ]);

  if (clientsRes.error) return NextResponse.json({ message: clientsRes.error.message }, { status: 500 });
  if (leadsRes.error) return NextResponse.json({ message: leadsRes.error.message }, { status: 500 });

  const leadByEmail = new Map<string, string>();
  const leadByPhone = new Map<string, string>();
  for (const lead of leadsRes.data ?? []) {
    if (lead.email) leadByEmail.set(String(lead.email).toLowerCase(), lead.id);
    const leadDigits = digits(lead.phone);
    if (leadDigits) leadByPhone.set(leadDigits, lead.id);
  }

  const countsByLead: Record<string, number> = {};
  for (const client of clientsRes.data ?? []) {
    const count = countsByClient.get(client.id) ?? 0;
    if (count === 0) continue;
    const email = client.email ? String(client.email).toLowerCase() : '';
    const phone = digits(client.phone);
    const leadId = (email && leadByEmail.get(email)) || (phone && leadByPhone.get(phone)) || null;
    if (leadId) {
      countsByLead[leadId] = (countsByLead[leadId] ?? 0) + count;
    }
  }

  return NextResponse.json(countsByLead, { status: 200 });
}
