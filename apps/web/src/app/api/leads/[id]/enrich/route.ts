import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../lib/api-auth';
import {
  fmcsaConfigured,
  fmcsaGetCarrier,
  fmcsaSearchByName,
  oshaConfigured,
  oshaInspectionsByName,
  stateFromAddress,
} from '../../../../../lib/enrichment';

import { databaseError, friendlyErrorMessage, workspaceApiError } from '../../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ id: string }>;
}

interface EnrichPayload {
  source?: 'fmcsa' | 'osha';
  /** Confirming a specific FMCSA match from the candidate list. */
  dot_number?: string;
}

/**
 * Pulls public safety/compliance records for a lead and stores them under
 * form_payload.profile.enrichment. FMCSA returns candidates when the name
 * match is ambiguous; the caller confirms with dot_number.
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
  if (!leadId) return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });

  const payload = (await request.json().catch(() => ({}))) as EnrichPayload;
  const source = payload.source === 'osha' ? 'osha' : 'fmcsa';

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id,full_name,address,form_payload')
    .eq('id', leadId)
    .maybeSingle();
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  if (!lead) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });

  const state = stateFromAddress(lead.address);
  const save = async (record: Awaited<ReturnType<typeof fmcsaGetCarrier>> | Awaited<ReturnType<typeof oshaInspectionsByName>>, matchMethod: 'name_search' | 'agent_selected_dot'): Promise<void> => {
    const update = await supabase.rpc('record_intelligence_enrichment', {
      p_lead: leadId, p_actor: session.user.id, p_source: source, p_record: { ...record, match_method: matchMethod },
      p_expected: { full_name: lead.full_name, address: lead.address }, p_match_method: matchMethod,
    });
    if (update.error) throw databaseError(update.error);
    if (update.data !== true) throw new Error('Source observation could not be verified.');
  };

  try {
    if (source === 'fmcsa') {
      if (!fmcsaConfigured()) {
        return NextResponse.json(
          {
            message:
              'DOT lookups are not configured yet. Get a free WebKey at mobile.fmcsa.dot.gov/QCDevsite (sign in with Login.gov, create a WebKey) and add FMCSA_WEBKEY to apps/web/.env.local, then restart the site.',
          },
          { status: 503 },
        );
      }

      if (payload.dot_number) {
        const record = await fmcsaGetCarrier(payload.dot_number);
        await save(record, 'agent_selected_dot');
        return NextResponse.json({ saved: true, fmcsa: record }, { status: 200 });
      }

      const candidates = await fmcsaSearchByName(lead.full_name, state);
      if (candidates.length === 0) {
        return NextResponse.json({ saved: false, candidates: [], message: 'No DOT-registered carrier matched this name.' }, { status: 200 });
      }
      if (candidates.length === 1) {
        const record = await fmcsaGetCarrier(candidates[0].dot_number);
        await save(record, 'name_search');
        return NextResponse.json({ saved: true, fmcsa: record }, { status: 200 });
      }
      return NextResponse.json({ saved: false, candidates }, { status: 200 });
    }

    // OSHA
    if (!oshaConfigured()) {
      return NextResponse.json(
        {
          message:
            'OSHA lookups are not configured yet. Register for a free key at dataportal.dol.gov/registration and add DOL_API_KEY to apps/web/.env.local, then restart the site.',
        },
        { status: 503 },
      );
    }

    const record = await oshaInspectionsByName(lead.full_name, state);
    await save(record, 'name_search');
    return NextResponse.json({ saved: true, osha: record }, { status: 200 });
  } catch (err) {
    return workspaceApiError(err, 'intelligence/enrichment');
  }
}
