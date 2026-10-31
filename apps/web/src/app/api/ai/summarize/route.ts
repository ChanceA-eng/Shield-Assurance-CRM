import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { recordOutreachContext } from '../../../../lib/lead-outreach-context';
import { workspaceApiError } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';

function safeDate(value?: string | null): string {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!isUuid(clientId)) {
    return NextResponse.json({ message: 'A valid clientId is required.' }, { status: 400 });
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
  if (!clientRes.data) return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
  let contextData: Awaited<ReturnType<typeof recordOutreachContext>>;
  try {
    contextData = await recordOutreachContext(supabase, { type: 'client', id: clientId });
  } catch (failure) {
    return workspaceApiError(failure, 'account-summary/context');
  }

  const clientName = clientRes.data?.full_name ?? 'This client';
  const items = commsRes.data ?? [];

  const conversationSummary = (() => {
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
  const newestNote = [...contextData.workspace_notes].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0];
  const summary = [
    conversationSummary,
    newestNote ? `Latest saved ${newestNote.note_type} note: ${newestNote.content.slice(0, 500)}${newestNote.content.length > 500 ? '...' : ''}` : '',
    contextData.workspace_assets.length ? `${contextData.workspace_assets.length} current inventory records; this does not confirm insurance coverage.` : '',
  ].filter(Boolean).join(' ');

  const activity = await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'account_summary',
      title: 'Prepared account conversation and note summary',
      body: summary,
      metadata: { source: 'api.ai.summarize', engine: 'rules' },
      occurred_at: new Date().toISOString(),
    },
  ]);
  if (activity.error) return NextResponse.json({ message: activity.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, summary }, { status: 200 });
}
