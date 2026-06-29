import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface DraftPayload {
  prompt?: string;
  channel?: 'email' | 'sms';
  subject?: string;
}

function normalize(value?: string | null): string {
  return (value ?? '').trim();
}

function summarizeRecentContext(items: Array<{ direction?: string | null; subject?: string | null; body?: string | null }>): string {
  if (items.length === 0) return 'No prior conversation context is available.';
  const last = items[0];
  const lastTopic = normalize(last.subject) || normalize(last.body).slice(0, 90) || 'recent client outreach';
  const inbound = items.filter((item) => normalize(item.direction).toLowerCase() === 'inbound').length;
  const outbound = items.length - inbound;
  return `Recent thread includes ${items.length} touchpoints (${inbound} inbound / ${outbound} outbound). Latest topic: ${lastTopic}.`;
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

  const payload = (await request.json().catch(() => ({}))) as DraftPayload;
  const prompt = normalize(payload.prompt);
  if (!prompt) {
    return NextResponse.json({ message: 'prompt is required.' }, { status: 400 });
  }

  const [clientRes, commsRes, policiesRes] = await Promise.all([
    supabase.from('clients').select('full_name').eq('id', clientId).maybeSingle(),
    supabase
      .from('communication_log')
      .select('direction,subject,body,sent_at')
      .eq('client_id', clientId)
      .order('sent_at', { ascending: false })
      .limit(8),
    supabase.from('policies').select('carrier,line_of_business,renewal_date,status').eq('client_id', clientId).limit(5),
  ]);

  if (clientRes.error) return NextResponse.json({ message: clientRes.error.message }, { status: 500 });
  if (commsRes.error) return NextResponse.json({ message: commsRes.error.message }, { status: 500 });
  if (policiesRes.error) return NextResponse.json({ message: policiesRes.error.message }, { status: 500 });

  const clientName = normalize(clientRes.data?.full_name) || 'Client';
  const recentContext = summarizeRecentContext(commsRes.data ?? []);

  const policyHint = (() => {
    const active = (policiesRes.data ?? []).find((row) => normalize(row.status).toLowerCase() === 'active');
    if (!active) return '';
    const carrier = normalize(active.carrier);
    const lob = normalize(active.line_of_business);
    return [carrier, lob].filter(Boolean).join(' · ');
  })();

  const channel = payload.channel ?? 'email';
  const subject = normalize(payload.subject) || (channel === 'sms' ? `Quick Follow-up for ${clientName}` : `Follow-up for ${clientName}`);

  const text = [
    `Hi ${clientName},`,
    '',
    `${prompt.charAt(0).toUpperCase()}${prompt.slice(1)}.`,
    policyHint ? `Account context: ${policyHint}.` : '',
    '',
    'Please reply when convenient and we will take care of the next steps right away.',
    '',
    'Thank you,',
    'Shield Assurance Team',
  ]
    .filter(Boolean)
    .join('\n');

  await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'ai_draft',
      title: 'Drafted outbound message with AI',
      body: `${recentContext}\n\nPrompt: ${prompt}`,
      metadata: { source: 'api.ai.draft-message', channel },
      occurred_at: new Date().toISOString(),
    },
  ]);

  return NextResponse.json({ ok: true, subject, text }, { status: 200 });
}
