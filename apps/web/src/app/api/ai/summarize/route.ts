import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

function safeDate(value?: string | null): string {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json({ message: 'clientId is required.' }, { status: 400 });
  }

  const [clientRes, commsRes] = await Promise.all([
    supabase.from('clients').select('id,full_name').eq('id', clientId).maybeSingle(),
    supabase
      .from('communication_log')
      .select('channel,direction,subject,body,sent_at')
      .eq('client_id', clientId)
      .in('channel', ['email', 'sms'])
      .order('sent_at', { ascending: false })
      .limit(40),
  ]);

  if (clientRes.error) {
    return NextResponse.json({ message: clientRes.error.message }, { status: 500 });
  }
  if (commsRes.error) {
    return NextResponse.json({ message: commsRes.error.message }, { status: 500 });
  }

  const clientName = clientRes.data?.full_name ?? 'This client';
  const items = commsRes.data ?? [];

  const summary = (() => {
    if (items.length === 0) {
      return `${clientName} has no conversation history yet.`;
    }

    const inbound = items.filter((item) => item.direction === 'inbound').length;
    const outbound = items.length - inbound;
    const channels = Array.from(new Set(items.map((item) => item.channel))).join(', ');
    const latest = items[0];

    const latestTopic = latest.subject?.trim() || latest.body?.slice(0, 80)?.trim() || 'recent follow-up';

    return `${clientName} has ${items.length} recent ${channels || 'email'} touchpoints (${inbound} inbound / ${outbound} outbound). Latest contact was ${safeDate(latest.sent_at)} regarding ${latestTopic}.`;
  })();

  await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'ai_summary',
      title: 'Generated AI conversation summary',
      body: summary,
      metadata: { source: 'api.ai.summarize' },
      occurred_at: new Date().toISOString(),
    },
  ]);

  return NextResponse.json({ ok: true, summary }, { status: 200 });
}
