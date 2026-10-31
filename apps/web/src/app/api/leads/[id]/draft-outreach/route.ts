import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';
import { draftOutreach, generateTalkingPoints } from '../../../../../lib/outreach-ai';
import { leadOutreachContext } from '../../../../../lib/lead-outreach-context';
import { workspaceApiError } from '../../../../../lib/workspace-api';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * AI assistance for a lead, grounded in its stored profile.
 * POST body: { mode: 'draft' | 'talking_points', instruction?: string }
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string; instruction?: string };
  const mode = body.mode === 'talking_points' ? 'talking_points' : 'draft';

  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
  let contextData: Awaited<ReturnType<typeof leadOutreachContext>>;
  try {
    contextData = await leadOutreachContext(supabase, leadId);
  } catch (failure) {
    return workspaceApiError(failure, 'lead-outreach/context');
  }

  if (mode === 'talking_points') {
    const points = await generateTalkingPoints({ ...lead, ...contextData });
    if (!points) {
      return NextResponse.json(
        { message: 'AI drafting is unavailable. Check that OPENAI_API_KEY is configured.' },
        { status: 503 },
      );
    }
    return NextResponse.json(points, { status: 200 });
  }

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : undefined;
  const draft = await draftOutreach({ ...lead, ...contextData }, instruction || undefined);
  if (!draft) {
    return NextResponse.json(
      { message: 'AI drafting is unavailable. Check that OPENAI_API_KEY is configured.' },
      { status: 503 },
    );
  }

  return NextResponse.json(draft, { status: 200 });
}
