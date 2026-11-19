import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../lib/api-auth';
import { draftOutreach, generateTalkingPoints } from '../../../../../lib/outreach-ai';
import { leadOutreachContext } from '../../../../../lib/lead-outreach-context';
import { workspaceApiError, workspaceBody, friendlyErrorMessage } from '../../../../../lib/workspace-api';
import { isOutreachTemplate } from '@crm/shared';
import { loadCurrentDossierDraftFacts } from '../../../../../lib/dossier';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * AI assistance for a lead, grounded in its stored profile.
 * POST body: { mode: 'draft' | 'talking_points', instruction?: string, template?: OutreachTemplate }
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  try {
    const body = await workspaceBody(request);
    if (body.include_dossier !== undefined && typeof body.include_dossier !== 'boolean') {
      return NextResponse.json({ message: 'Choose whether to include confirmed dossier findings.' }, { status: 400 });
    }
    if (body.template !== undefined && !isOutreachTemplate(body.template)) {
      return NextResponse.json({ message: 'Choose a valid email template.' }, { status: 400 });
    }
    const mode = body.mode === 'talking_points' ? 'talking_points' : 'draft';
    const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
    if (!lead) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
    const contextData = await leadOutreachContext(supabase, leadId, session.user.id);
    const confirmedDossierFacts = body.include_dossier === true
      ? await loadCurrentDossierDraftFacts(supabase, session.user.id, { type: 'lead', id: leadId })
      : [];

    if (mode === 'talking_points') {
      const points = await generateTalkingPoints({ ...lead, ...contextData, confirmed_dossier_facts: confirmedDossierFacts });
      if (!points) {
        return NextResponse.json(
          { message: 'AI returned no usable talking points. Try again or review the lead details. No message was sent.' },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ...points,
        dossier_requested: body.include_dossier === true,
        dossier_facts_included: confirmedDossierFacts.map((fact) => fact.label),
      }, { status: 200 });
    }

    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : undefined;
    const draft = await draftOutreach({ ...lead, ...contextData, confirmed_dossier_facts: confirmedDossierFacts }, instruction || undefined,
      isOutreachTemplate(body.template) ? body.template : undefined);
    if (!draft) {
      return NextResponse.json(
        { message: 'AI returned no usable draft. Try again or review the lead details. No message was sent.' },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ...draft,
      dossier_requested: body.include_dossier === true,
      dossier_facts_included: confirmedDossierFacts.map((fact) => fact.label),
    }, { status: 200 });
  } catch (failure) {
    return workspaceApiError(failure, 'lead-outreach/draft');
  }
}
