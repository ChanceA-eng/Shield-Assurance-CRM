import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { draftOutreach } from '../../../../lib/outreach-ai';
import { recordOutreachContext } from '../../../../lib/lead-outreach-context';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { getApiSession, apiActorName } from '../../../../lib/api-auth';
import { isUuid } from '../../../../lib/workspace-validation';
import { isOutreachTemplate } from '@crm/shared';

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
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!isUuid(clientId)) {
    return NextResponse.json({ message: 'A valid clientId is required.' }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  let contextData: Awaited<ReturnType<typeof recordOutreachContext>>;
  try {
    payload = await workspaceBody(request);
    contextData = await recordOutreachContext(supabase, { type: 'client', id: clientId });
  } catch (failure) {
    return workspaceApiError(failure, 'account-draft/context');
  }
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
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
    supabase.from('policies').select('carrier,line_of_business,effective_date,expiration_date,renewal_date,status').eq('client_id', clientId).limit(50),
  ]);

  if (clientRes.error) return NextResponse.json({ message: clientRes.error.message }, { status: 500 });
  if (commsRes.error) return NextResponse.json({ message: commsRes.error.message }, { status: 500 });
  if (policiesRes.error) return NextResponse.json({ message: policiesRes.error.message }, { status: 500 });
  if (!clientRes.data) return NextResponse.json({ message: 'Client not found.' }, { status: 404 });

  const clientName = normalize(clientRes.data?.full_name) || 'Client';
  const recentContext = summarizeRecentContext(commsRes.data ?? []);

  const policyHint = (() => {
    const active = (policiesRes.data ?? []).find((row) => normalize(row.status).toLowerCase() === 'active');
    if (!active) return '';
    const carrier = normalize(active.carrier);
    const lob = normalize(active.line_of_business);
    const renewal = normalize(active.renewal_date);
    return [carrier, lob, renewal ? `renews ${renewal}` : ''].filter(Boolean).join(' · ');
  })();

  const channel = payload.channel ?? 'email';
  if (channel !== 'email' && channel !== 'sms') return NextResponse.json({ message: 'Choose email or SMS.' }, { status: 400 });
  if (payload.template !== undefined && !isOutreachTemplate(payload.template)) return NextResponse.json({ message: 'Choose a valid email template.' }, { status: 400 });

  // Real AI drafting grounded on the client's policies and conversation history.
  try {
  const aiDraft = await draftOutreach(
    {
      full_name: clientName,
      ...contextData,
      channel,
      line_of_business: (policiesRes.data ?? []).find((row) => normalize(row.status).toLowerCase() === 'active')?.line_of_business ?? null,
      form_payload: {
        profile: {
          kind: 'generic',
          extras: {
            'Account context': policyHint || 'Active policy details have not been confirmed.',
            'Policy records': JSON.stringify(policiesRes.data ?? []),
            'Conversation history': (commsRes.data ?? []).map((row) => `${row.sent_at} ${row.direction}: ${row.subject ?? ''}\n${row.body ?? ''}`).join('\n\n') || recentContext,
            'Channel': channel,
          },
        },
      },
    },
    prompt,
    isOutreachTemplate(payload.template) ? payload.template : undefined,
  );

  if (!aiDraft) return NextResponse.json({ message: 'AI drafting is unavailable. Check the AI configuration; no substitute draft has been generated.' }, { status: 503 });
  const subject = aiDraft.subject;
  const text = aiDraft.body;

  const activity = await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'ai_draft',
      title: 'Drafted outbound message with AI',
      body: `${recentContext}\n\nPrompt: ${prompt}`,
      metadata: { source: 'api.ai.draft-message', channel, actor: apiActorName(session.user) },
      occurred_at: new Date().toISOString(),
    },
  ]);
  if (activity.error) return NextResponse.json({ message: activity.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, subject, text, cited_signals: aiDraft.cited_signals }, { status: 200 });
  } catch (failure) {
    return workspaceApiError(failure, 'account-draft/generation');
  }
}
