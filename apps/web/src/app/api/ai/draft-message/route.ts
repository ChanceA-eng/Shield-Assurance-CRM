import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { draftOutreach } from '../../../../lib/outreach-ai';
import { recordOutreachContext } from '../../../../lib/lead-outreach-context';
import { workspaceApiError, workspaceBody, friendlyErrorMessage } from '../../../../lib/workspace-api';
import { getApiSession, apiActorName } from '../../../../lib/api-auth';
import { isUuid } from '../../../../lib/workspace-validation';
import { isOutreachTemplate } from '@crm/shared';
import { loadCurrentDossierDraftFacts, type DossierDraftFact } from '../../../../lib/dossier';

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
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!isUuid(clientId)) {
    return NextResponse.json({ message: 'A valid clientId is required.' }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  let contextData: Awaited<ReturnType<typeof recordOutreachContext>>;
  try {
    payload = await workspaceBody(request);
    if (payload.include_dossier !== undefined && typeof payload.include_dossier !== 'boolean') {
      return NextResponse.json({ message: 'Choose whether to include confirmed dossier findings.' }, { status: 400 });
    }
    contextData = await recordOutreachContext(supabase, { type: 'client', id: clientId }, session.user.id);
  } catch (failure) {
    return workspaceApiError(failure, 'account-draft/context');
  }
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ message: 'prompt is required.' }, { status: 400 });
  }

  const [clientRes, policiesRes] = await Promise.all([
    supabase.from('clients').select('full_name,preferred_channel').eq('id', clientId).maybeSingle(),
    supabase.from('policies').select('carrier,line_of_business,effective_date,expiration_date,renewal_date,status').eq('client_id', clientId).limit(50),
  ]);

  if (clientRes.error) return NextResponse.json({ message: friendlyErrorMessage(clientRes.error) }, { status: 500 });
  if (policiesRes.error) return NextResponse.json({ message: friendlyErrorMessage(policiesRes.error) }, { status: 500 });
  if (!clientRes.data) return NextResponse.json({ message: 'Client not found.' }, { status: 404 });

  const clientName = normalize(clientRes.data?.full_name) || 'Client';
  const recentContext = summarizeRecentContext(contextData.recent_conversation);

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
  let confirmedDossierFacts: DossierDraftFact[] = [];
  try {
    confirmedDossierFacts = payload.include_dossier === true
      ? await loadCurrentDossierDraftFacts(supabase, session.user.id, { type: 'client', id: clientId })
      : [];
  } catch (failure) {
    return workspaceApiError(failure, 'account-draft/dossier');
  }

  // Real AI drafting grounded on the client's policies and conversation history.
  try {
  const aiDraft = await draftOutreach(
    {
      full_name: clientName,
      ...contextData,
      confirmed_dossier_facts: confirmedDossierFacts,
      channel,
      line_of_business: (policiesRes.data ?? []).find((row) => normalize(row.status).toLowerCase() === 'active')?.line_of_business ?? null,
      form_payload: {
        profile: {
          kind: 'generic',
          extras: {
            'Account context': policyHint || 'Active policy details have not been confirmed.',
            'Policy records': JSON.stringify(policiesRes.data ?? []),
            'Account contact preference (not consent)': normalize(clientRes.data.preferred_channel) || 'Not recorded',
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
  if (activity.error) return NextResponse.json({ message: friendlyErrorMessage(activity.error) }, { status: 500 });

  return NextResponse.json({
    ok: true,
    subject,
    text,
    cited_signals: aiDraft.cited_signals,
    dossier_requested: payload.include_dossier === true,
    dossier_facts_included: confirmedDossierFacts.map((fact) => fact.label),
  }, { status: 200 });
  } catch (failure) {
    return workspaceApiError(failure, 'account-draft/generation');
  }
}
